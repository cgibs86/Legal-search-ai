"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Building2, CheckCheck, ExternalLink, FileText, Mail, RefreshCw, Search, Trash2, User } from "lucide-react";
import type { AlertItem, Watchlist } from "@/lib/data/types";
import type { DiffChange } from "@/lib/docket/diff";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, EmptyState, Notice, Select, Skeleton, Toggle } from "@/components/ui/primitives";
import { Tabs, useToast } from "@/components/ui/overlay";
import { searchHref } from "@/lib/search/urlParams";
import { cn, formatDate, relativeTime } from "@/lib/utils";

const KIND_ICON: Record<Watchlist["kind"], typeof Bell> = { person: User, company: Building2, attorney: User, law_firm: Building2, case: FileText, docket: FileText, search: Search };
const KIND_LABEL: Record<Watchlist["kind"], string> = { person: "Person", company: "Company", attorney: "Attorney", law_firm: "Law firm", case: "Case", docket: "Docket", search: "Search" };

export function RadarView({ activeLimit, priority, emailEnabled, demo }: { activeLimit: number; priority: boolean; emailEnabled: boolean; demo: boolean }) {
  const toast = useToast();
  const [tab, setTab] = useState<"alerts" | "watching">("alerts");
  const [watches, setWatches] = useState<Watchlist[] | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, a] = await Promise.all([api<{ watchlists: Watchlist[] }>("/api/watchlists"), api<{ alerts: AlertItem[]; unread: number }>(`/api/alerts${unreadOnly ? "?unread=1" : ""}`)]);
      setWatches(w.watchlists);
      setAlerts(a.alerts);
      setUnread(a.unread);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [unreadOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, p: Partial<Pick<Watchlist, "frequency" | "channels" | "active">>) {
    const prev = watches;
    setWatches((ws) => ws?.map((w) => (w.id === id ? { ...w, ...p } : w)) ?? null);
    try {
      await api("/api/watchlists", { method: "PATCH", json: { id, ...p } });
    } catch (e) {
      setWatches(prev);
      toast((e as ApiError).message, "error");
    }
  }

  async function remove(w: Watchlist) {
    if (!confirm(`Stop watching “${w.label}”? Past alerts stay in your feed.`)) return;
    try {
      await api(`/api/watchlists?id=${w.id}`, { method: "DELETE" });
      setWatches((ws) => ws?.filter((x) => x.id !== w.id) ?? null);
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  async function checkNow(w: Watchlist) {
    setChecking(w.id);
    try {
      const r = await api<{ alerts: number; message: string }>(`/api/watchlists/${w.id}/check`, { method: "POST" });
      toast(r.message, r.alerts ? "success" : "neutral");
      await load();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setChecking(null);
    }
  }

  async function markRead(id: string) {
    setAlerts((as) => as?.map((a) => (a.id === id ? { ...a, readAt: new Date().toISOString() } : a)) ?? null);
    const r = await api<{ unread: number }>("/api/alerts", { method: "POST", json: { id } }).catch(() => null);
    if (r) setUnread(r.unread);
  }

  async function markAll() {
    const r = await api<{ unread: number }>("/api/alerts", { method: "POST", json: { all: true } }).catch(() => null);
    if (r) {
      setUnread(r.unread);
      setAlerts((as) => as?.map((a) => ({ ...a, readAt: a.readAt ?? new Date().toISOString() })) ?? null);
    }
  }

  if (error) return <Notice tone="rose" title="Could not load Case Radar">{error.message}</Notice>;
  if (!watches || !alerts) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  const active = watches.filter((w) => w.active).length;

  return (
    <div className="space-y-4">
      {demo ? (
        <Notice tone="amber" title="Demo workspace">
          Demo docket watches start from a simulated earlier check (Sep 12, 2026) of the same real docket snapshot, so “Check now” shows a genuine Docket Diff. The demo data never changes after that.
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          tabs={[
            { id: "alerts", label: "Alerts", badge: unread ? <Badge tone="accent">{unread}</Badge> : undefined },
            { id: "watching", label: "Watching", badge: <span className="text-xs text-subtle">{active}/{activeLimit}</span> },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="ml-auto flex items-center gap-2">
          {tab === "alerts" ? (
            <>
              <label className="flex items-center gap-2 text-xs text-muted">
                <Toggle checked={unreadOnly} onChange={setUnreadOnly} label="Unread only" />
                Unread only
              </label>
              {unread ? (
                <Button size="sm" variant="secondary" onClick={markAll}>
                  <CheckCheck className="h-4 w-4" /> Mark all read
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {tab === "alerts" ? (
        alerts.length ? (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <AlertCard key={a.id} alert={a} onRead={() => markRead(a.id)} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Bell className="h-6 w-6" />} title={unreadOnly ? "No unread alerts" : "No alerts yet"}>
            {watches.length ? "Case Radar checks your watches on schedule. New records and docket changes will appear here." : "Watch a person, company, attorney, law firm or docket from any search result."}
          </EmptyState>
        )
      ) : null}

      {tab === "watching" ? (
        watches.length ? (
          <div className="space-y-2">
            {watches.map((w) => {
              const Icon = KIND_ICON[w.kind];
              const href = w.query.docketId ? `/docket/${w.query.docketId}` : w.query.query ? searchHref(w.query.query, w.query.entityType, w.query.filters) : null;
              return (
                <div key={w.id} className={cn("rounded-2xl border border-line bg-elev p-4 shadow-card", !w.active && "opacity-70")}>
                  <div className="flex flex-wrap items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 text-subtle" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {href ? (
                          <Link href={href} className="font-medium hover:text-accent">
                            {w.label}
                          </Link>
                        ) : (
                          <span className="font-medium">{w.label}</span>
                        )}
                        <Badge>{KIND_LABEL[w.kind]}</Badge>
                        {!w.active ? <Badge tone="amber">Paused</Badge> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-subtle">{w.lastCheckedAt ? `Last checked ${relativeTime(w.lastCheckedAt)}` : "Waiting for first check (records a baseline)"}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={w.frequency} onChange={(e) => patch(w.id, { frequency: e.target.value as Watchlist["frequency"] })} className="h-8 w-auto text-xs" aria-label="Frequency">
                        <option value="immediate">{priority ? "Priority (~20 min)" : "Hourly"}</option>
                        <option value="daily">Daily digest</option>
                        <option value="weekly">Weekly digest</option>
                      </Select>
                      <button onClick={() => patch(w.id, { channels: { ...w.channels, email: !w.channels.email } })} disabled={!emailEnabled} className={cn("inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs", w.channels.email && emailEnabled ? "border-accent/40 text-accent" : "border-line text-subtle")} title={emailEnabled ? "Email alerts" : "Email is not configured on this server"}>
                        <Mail className="h-3.5 w-3.5" /> Email
                      </button>
                      <Button size="sm" variant="secondary" onClick={() => checkNow(w)} loading={checking === w.id} disabled={!w.active}>
                        <RefreshCw className="h-3.5 w-3.5" /> Check now
                      </Button>
                      <button onClick={() => patch(w.id, { active: !w.active })} className="rounded-lg p-1.5 text-subtle hover:text-fg" aria-label={w.active ? "Pause" : "Resume"} title={w.active ? "Pause" : "Resume"}>
                        {w.active ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      </button>
                      <button onClick={() => remove(w)} className="rounded-lg p-1.5 text-subtle hover:text-rose" aria-label="Delete watch">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-subtle">
              Scheduled checks run in the background; “Check now” is limited per hour by plan. Hourly checks depend on the scheduler your deployment runs (see README). SMS and push are not available yet.
            </p>
          </div>
        ) : (
          <EmptyState icon={<Bell className="h-6 w-6" />} title="Nothing watched yet">
            Open any search result, docket or entity profile and choose “Watch”. Example: watch <em>Acme Corporation</em> to be alerted when it appears in a new federal lawsuit.
          </EmptyState>
        )
      ) : null}
    </div>
  );
}

function AlertCard({ alert: a, onRead }: { alert: AlertItem; onRead: () => void }) {
  const [open, setOpen] = useState(false);
  const diff = (a.payload.diff as { changes: DiffChange[]; since: string } | undefined) ?? null;
  const link = typeof a.payload.link === "string" ? a.payload.link.replace(/^https?:\/\/[^/]+/, "") : null;
  return (
    <li className={cn("rounded-2xl border bg-elev p-4 shadow-card", a.readAt ? "border-line" : "border-accent/40")}>
      <div className="flex items-start gap-2">
        {!a.readAt ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={a.kind === "docket_diff" ? "accent" : a.kind === "system" ? "neutral" : "cyan"}>{a.kind === "docket_diff" ? "Docket Diff" : a.kind === "new_record" ? "New record" : a.kind === "status_change" ? "Status change" : "Notice"}</Badge>
            <span className="text-xs text-subtle">{formatDate(a.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </div>
          <div className="mt-1 font-medium leading-snug">{a.title}</div>
          <p className="mt-0.5 text-sm text-muted">{a.summary}</p>
          {diff?.changes.length ? (
            <>
              <button onClick={() => setOpen((v) => !v)} className="mt-2 text-xs text-accent hover:underline">
                {open ? "Hide changes" : `Show ${diff.changes.length} changes`}
              </button>
              {open ? (
                <ul className="mt-2 space-y-1.5 border-l-2 border-accent/40 pl-3">
                  {diff.changes.map((c, i) => (
                    <li key={i} className="text-sm">
                      <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{c.kind.replace(/_/g, " ")}</span>
                      {c.title}
                      {c.detail ? <span className="text-muted"> — {c.detail.slice(0, 220)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {link ? (
            <Link href={link} onClick={onRead} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              Open <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null}
          {!a.readAt ? (
            <button onClick={onRead} className="text-xs text-subtle hover:text-fg">
              Mark read
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
