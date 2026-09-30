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
