import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv, resolveDataMode } from "@/lib/config/env";
import { getPlan, type PlanId } from "@/lib/config/plans";
import type { EntityType, SearchFilters } from "@/lib/domain/types";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getPrimaryProvider } from "@/lib/providers/registry";
import { runSearch } from "@/lib/search/orchestrator";
import { diffDocket, type DocketSnapshot } from "@/lib/docket/diff";
import { budgetUsed } from "@/lib/usage/providerBudget";
import { CL_BUDGET_KEY } from "@/lib/providers/courtlistener/client";
import { allMemoryStores, memoryStore } from "@/lib/data/memoryRepo";
import { log, errorMessage } from "@/lib/log";
import { recordUsage } from "@/lib/usage/events";
import { emailChannel, type AlertMessage } from "./notify";
import type { AlertItem } from "@/lib/data/types";

/**
 * CASE RADAR runner. Invoked by the cron endpoint. For each due watchlist:
 *   - entity/search watches re-run the search for recent filings and alert on unseen records
 *   - docket watches load the docket and run DOCKET DIFF against the last snapshot
 * Respects the provider request budget and stops early when it runs low.
 */

const INTERVAL_MINUTES: Record<string, number> = { immediate: 60, daily: 24 * 60, weekly: 7 * 24 * 60 };
const PRIORITY_IMMEDIATE_MINUTES = 20;
const BUDGET_RESERVE = 20;

export interface WatchRow {
  id: string;
  user_id: string;
  kind: string;
  label: string;
  query: { query?: string; entityType?: EntityType; filters?: SearchFilters; provider?: string; docketId?: string; recordKey?: string };
  frequency: "immediate" | "daily" | "weekly";
  channels: { email: boolean; in_app: boolean };
  active: boolean;
  last_checked_at: string | null;
  seen_keys: string[];
}

export interface RunReport {
  checked: number;
  alertsCreated: number;
  emailsSent: number;
  skippedForBudget: number;
  errors: number;
}

export function isDue(w: Pick<WatchRow, "frequency" | "last_checked_at" | "active">, plan: PlanId, now: Date): boolean {
  if (!w.active) return false;
  if (!w.last_checked_at) return true;
  let minutes = INTERVAL_MINUTES[w.frequency] ?? 24 * 60;
  if (w.frequency === "immediate" && getPlan(plan).features.priorityRefresh) minutes = PRIORITY_IMMEDIATE_MINUTES;
  return now.getTime() - new Date(w.last_checked_at).getTime() >= minutes * 60_000 - 60_000;
}

interface Store {
  dueWatchlists(now: Date): Promise<{ watch: WatchRow; plan: PlanId; email: string | null }[]>;
  latestSnapshot(watchId: string): Promise<DocketSnapshot | null>;
  saveSnapshot(watch: WatchRow, snap: DocketSnapshot): Promise<void>;
  insertAlerts(rows: Omit<AlertItem, "id" | "readAt" | "createdAt">[], userId: string): Promise<string[]>;
  markEmailed(ids: string[]): Promise<void>;
  updateWatch(id: string, patch: { last_checked_at: string; seen_keys?: string[] }): Promise<void>;
}

function dbStore(): Store | null {
  const db = getSupabaseAdmin();
  if (!db) return null;
  return {
    async dueWatchlists(now) {
      const { data: rows } = await db.from("watchlists").select("*").eq("active", true).limit(500);
      const users = [...new Set((rows ?? []).map((r) => r.user_id))];
      const { data: subs } = users.length ? await db.from("subscriptions").select("user_id, plan_id, status").in("user_id", users) : { data: [] };
      const { data: profiles } = users.length ? await db.from("profiles").select("id, email").in("id", users) : { data: [] };
      const planOf = (u: string): PlanId => {
        const s = (subs ?? []).filter((x) => x.user_id === u && ["active", "trialing", "past_due"].includes(x.status));
        const rank: Record<string, number> = { search: 1, research_pro: 2, intelligence: 3 };
        s.sort((a, b) => rank[b.plan_id] - rank[a.plan_id]);
        return (s[0]?.plan_id as PlanId) ?? "free";
      };
      return (rows ?? [])
        .map((w) => ({ watch: w as WatchRow, plan: planOf(w.user_id), email: (profiles ?? []).find((p) => p.id === w.user_id)?.email ?? null }))
        .filter((x) => x.plan !== "free" && isDue(x.watch, x.plan, now));
    },
    async latestSnapshot(watchId) {
      const { data } = await db.from("docket_snapshots").select("snapshot").eq("watchlist_id", watchId).order("taken_at", { ascending: false }).limit(1).maybeSingle();
      return (data?.snapshot as DocketSnapshot) ?? null;
    },
    async saveSnapshot(watch, snap) {
      await db.from("docket_snapshots").insert({ watchlist_id: watch.id, provider: watch.query.provider ?? "courtlistener", provider_docket_id: watch.query.docketId, snapshot: snap });
    },
    async insertAlerts(rows, userId) {
      if (!rows.length) return [];
      const { data } = await db
        .from("alerts")
        .insert(rows.map((r) => ({ user_id: userId, watchlist_id: r.watchlistId, kind: r.kind, title: r.title, summary: r.summary, payload: r.payload })))
        .select("id");
      return (data ?? []).map((d) => d.id);
    },
    async markEmailed(ids) {
      if (ids.length) await db.from("alerts").update({ emailed_at: new Date().toISOString() }).in("id", ids);
    },
    async updateWatch(id, patch) {
      await db.from("watchlists").update(patch).eq("id", id);
    },
  };
}

function demoStore(): Store {
  return {
    async dueWatchlists(now) {
      const out: { watch: WatchRow; plan: PlanId; email: string | null }[] = [];
      for (const [userId, s] of allMemoryStores()) {
        for (const w of s.watchlists) {
          const row: WatchRow = { id: w.id, user_id: userId, kind: w.kind, label: w.label, query: w.query, frequency: w.frequency, channels: w.channels, active: w.active, last_checked_at: w.lastCheckedAt, seen_keys: w.seen };
          if (isDue(row, "intelligence", now)) out.push({ watch: row, plan: "intelligence", email: null });
        }
      }
      return out;
    },
    async latestSnapshot(watchId) {
      for (const [, s] of allMemoryStores()) {
        const w = s.watchlists.find((x) => x.id === watchId);
        if (w) return (w.snapshot as DocketSnapshot) ?? null;
      }
      return null;
    },
    async saveSnapshot(watch, snap) {
      const w = memoryStore(watch.user_id).watchlists.find((x) => x.id === watch.id);
      if (w) w.snapshot = snap;
    },
    async insertAlerts(rows, userId) {
      const s = memoryStore(userId);
      const ids: string[] = [];
      for (const r of rows) {
        const id = randomUUID();
        s.alerts.push({ ...r, id, readAt: null, createdAt: new Date().toISOString() });
        ids.push(id);
      }
      return ids;
    },
    async markEmailed() {},
    async updateWatch(id, patch) {
      for (const [, s] of allMemoryStores()) {
        const w = s.watchlists.find((x) => x.id === id);
        if (w) {
          w.lastCheckedAt = patch.last_checked_at;
          if (patch.seen_keys) w.seen = patch.seen_keys;
        }
      }
    },
  };
}

function daysAgo(now: Date, n: number) {
  return new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

export async function checkWatch(
  store: Store,
  entry: { watch: WatchRow; plan: PlanId },
  now: Date,
): Promise<Omit<AlertItem, "id" | "readAt" | "createdAt">[]> {
  const { watch, plan } = entry;
  const ctx = { userId: watch.user_id, plan, requestId: `radar-${watch.id}` };
  const site = getEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const alerts: Omit<AlertItem, "id" | "readAt" | "createdAt">[] = [];

  if (watch.kind === "docket" && watch.query.docketId) {
    const res = await getPrimaryProvider().getDocket(watch.query.docketId, ctx);
    if (!res.ok) throw new Error(res.error.message);
    const previous = await store.latestSnapshot(watch.id);
    const diff = diffDocket(previous, res.data, now);
    await store.saveSnapshot(watch, diff.newSnapshot);
    if (diff.hasChanges && getPlan(plan).features.docketDiff) {
      const summary = Object.entries(diff.counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
        .join(", ");
      alerts.push({
        watchlistId: watch.id,
        kind: "docket_diff",
        title: `NEW SINCE LAST CHECK · ${res.data.record.caseName}`,
        summary,
        payload: { diff: { since: diff.since, changes: diff.changes.slice(0, 40), counts: diff.counts }, docketId: watch.query.docketId, link: `${site}/docket/${watch.query.docketId}?diff=1` },
      });
    } else if (diff.hasChanges) {
      const newEntries = diff.changes.filter((c) => c.entryId).length;
      alerts.push({ watchlistId: watch.id, kind: "new_record", title: `New docket activity · ${res.data.record.caseName}`, summary: `${newEntries} new docket entr${newEntries === 1 ? "y" : "ies"}.`, payload: { link: `${site}/docket/${watch.query.docketId}` } });
    }
    return alerts;
  }

  if (!watch.query.query) return alerts;
  const since = watch.last_checked_at ? daysAgo(new Date(watch.last_checked_at), 3) : daysAgo(now, 30);
  const result = await runSearch(
    {
      query: watch.query.query,
      entityType: watch.query.entityType,
      mode: "universal",
      filters: { ...(watch.query.filters ?? {}), filedAfter: since, recordKinds: ["docket", "opinion"] },
      sort: "newest",
      includeVariants: true,
    },
    ctx,
  );
  const seen = new Set(watch.seen_keys ?? []);
  const fresh = result.hits.filter((h) => !seen.has(h.id));
  const firstRun = !watch.last_checked_at;
  if (!firstRun && fresh.length) {
    for (const h of fresh.slice(0, 20)) {
      alerts.push({
        watchlistId: watch.id,
        kind: "new_record",
        title: `${watch.label}: ${h.record.caseName}`,
        summary: `${h.record.court.citation ?? h.record.court.name}${h.record.docketNumber ? ` · ${h.record.docketNumber}` : ""}${h.record.dateFiled ? ` · filed ${h.record.dateFiled}` : ""} · ${h.match.types.join(", ")} match. ${h.match.identityNote ?? ""}`.trim(),
        payload: { recordKey: h.id, docketId: h.record.providerDocketId, link: h.record.providerDocketId ? `${site}/docket/${h.record.providerDocketId}` : `${site}/search?q=${encodeURIComponent(watch.query.query)}` },
      });
    }
  }
  const nextSeen = [...new Set([...fresh.map((h) => h.id), ...(watch.seen_keys ?? [])])].slice(0, 1000);
  await store.updateWatch(watch.id, { last_checked_at: now.toISOString(), seen_keys: nextSeen });
  return alerts;
}

export async function runRadar(now = new Date()): Promise<RunReport> {
  const store = dbStore() ?? demoStore();
  const env = getEnv();
  const report: RunReport = { checked: 0, alertsCreated: 0, emailsSent: 0, skippedForBudget: 0, errors: 0 };
  const due = await store.dueWatchlists(now);
  const byUser = new Map<string, { email: string | null; alerts: AlertMessage[]; ids: string[] }>();

  for (const entry of due) {
    if (resolveDataMode() === "live") {
      const used = await budgetUsed(CL_BUDGET_KEY);
      if (used >= env.COURTLISTENER_DAILY_REQUEST_BUDGET - BUDGET_RESERVE) {
        report.skippedForBudget += 1;
        continue;
      }
    }
    try {
      const alerts = await checkWatch(store, entry, now);
      if (entry.watch.kind === "docket") await store.updateWatch(entry.watch.id, { last_checked_at: now.toISOString() });
      report.checked += 1;
      if (!alerts.length) continue;
      const ids = await store.insertAlerts(alerts, entry.watch.user_id);
      report.alertsCreated += ids.length;
      recordUsage({ kind: "alert_sent", userId: entry.watch.user_id, quantity: ids.length, props: { kind: entry.watch.kind } });
      if (entry.watch.channels.email && entry.email) {
        const u = byUser.get(entry.watch.user_id) ?? { email: entry.email, alerts: [], ids: [] };
        u.alerts.push(...alerts.map((a) => ({ title: a.title, summary: a.summary, link: (a.payload.link as string) ?? null })));
        u.ids.push(...ids);
        byUser.set(entry.watch.user_id, u);
      }
    } catch (e) {
      report.errors += 1;
      log.warn("radar.watch_failed", { watchId: entry.watch.id, error: errorMessage(e) });
    }
  }

  for (const [, u] of byUser) {
    if (!u.email) continue;
    const subject = u.alerts.length === 1 ? u.alerts[0].title : `${u.alerts.length} new court-record updates`;
    if (await emailChannel.send(u.email, subject, u.alerts.slice(0, 50))) {
      report.emailsSent += 1;
      await store.markEmailed(u.ids);
    }
  }
  log.info("radar.run", { ...report });
  return report;
}
