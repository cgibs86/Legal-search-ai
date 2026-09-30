import "server-only";
import type { Viewer } from "@/lib/auth/session";
import type { DocketSnapshot } from "@/lib/docket/diff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { memoryStore } from "@/lib/data/memoryRepo";

/** The viewer's watch on a docket and its latest stored snapshot (for "NEW SINCE LAST CHECK"). */
export async function getDocketWatch(viewer: Viewer, docketId: string): Promise<{ watchId: string; snapshot: DocketSnapshot | null } | null> {
  if (!viewer.userId) return null;
  if (viewer.demo) {
    const w = memoryStore(viewer.userId).watchlists.find((x) => x.kind === "docket" && x.query.docketId === docketId);
    return w ? { watchId: w.id, snapshot: (w.snapshot as DocketSnapshot) ?? null } : null;
  }
  const db = await createSupabaseServer();
  if (!db) return null;
  const { data: watch } = await db.from("watchlists").select("id").eq("user_id", viewer.userId).eq("kind", "docket").eq("query->>docketId", docketId).limit(1).maybeSingle();
  if (!watch) return null;
  const { data: snap } = await db.from("docket_snapshots").select("snapshot").eq("watchlist_id", watch.id).order("taken_at", { ascending: false }).limit(1).maybeSingle();
  return { watchId: watch.id, snapshot: (snap?.snapshot as DocketSnapshot) ?? null };
}

/**
 * DEMO ONLY. A new docket watch in the demo workspace starts from a simulated earlier
 * check of the same real docket (entries filed before DEMO_BASELINE_DATE), so Docket Diff
 * has genuine entries to report. The UI labels this; it never runs in live mode.
 */
export const DEMO_BASELINE_DATE = "2026-09-12";

export async function seedDemoDocketBaseline(userId: string, watchId: string, docketId: string): Promise<boolean> {
  const { getPrimaryProvider } = await import("@/lib/providers/registry");
  const { snapshotOf } = await import("@/lib/docket/diff");
  const res = await getPrimaryProvider().getDocket(docketId, { requestId: "demo-baseline", userId, plan: "intelligence" });
  if (!res.ok) return false;
  const earlier = { ...res.data, entries: res.data.entries.filter((e) => (e.dateFiled ?? "") < DEMO_BASELINE_DATE), dateLastFiling: null };
  if (earlier.entries.length === res.data.entries.length) return false;
  const snap = snapshotOf(earlier, new Date(`${DEMO_BASELINE_DATE}T16:00:00Z`));
  const w = memoryStore(userId).watchlists.find((x) => x.id === watchId);
  if (!w) return false;
  w.snapshot = snap;
  w.lastCheckedAt = snap.capturedAt;
  return true;
}
