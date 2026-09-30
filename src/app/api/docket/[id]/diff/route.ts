import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json } from "@/lib/api/http";
import { requireFeature } from "@/lib/billing/entitlements";
import { getPrimaryProvider } from "@/lib/providers/registry";
import { diffDocket } from "@/lib/docket/diff";
import { getDocketWatch } from "@/lib/radar/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DOCKET DIFF preview: compares the current docket with the snapshot taken at the viewer's
 * last Case Radar check. Read-only — the stored snapshot only advances when Case Radar runs.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return apiError(400, "invalid_id", "Invalid docket id.");
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "docketDiff");
  if (!gate.allowed) return gateError(gate);
  const watch = await getDocketWatch(viewer, id);
  if (!watch) return json({ watching: false, diff: null });
  if (!watch.snapshot) return json({ watching: true, diff: null, message: "Case Radar will record a baseline on its next check. Changes appear here after that." });
  const res = await getPrimaryProvider().getDocket(id, { requestId: `diff-${id}`, userId: viewer.userId, plan: viewer.plan });
  if (!res.ok) return apiError(502, res.error.code, res.error.message);
  const diff = diffDocket(watch.snapshot, res.data);
  return json({ watching: true, diff: { since: diff.since, changes: diff.changes, counts: diff.counts, hasChanges: diff.hasChanges } });
}
