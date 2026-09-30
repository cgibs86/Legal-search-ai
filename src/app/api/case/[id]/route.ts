import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json } from "@/lib/api/http";
import { meterRecordView } from "@/lib/billing/entitlements";
import { getPrimaryProvider } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Opinion cluster detail (case law). Text is returned as an excerpt only. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return apiError(400, "invalid_id", "Invalid case id.");
  const viewer = await getViewer();
  const gate = await meterRecordView(viewer, `cluster:${id}`);
  if (!gate.allowed) return gateError(gate);
  const res = await getPrimaryProvider().getCase(id, { requestId: `case-${id}`, userId: viewer.userId, plan: viewer.plan });
  if (!res.ok) return apiError(res.error.code === "not_found" ? 404 : 502, res.error.code, res.error.message);
  const { record, opinionText } = res.data;
  return json({
    record,
    excerpt: opinionText ? { title: opinionText.title, text: opinionText.text.slice(0, 4000), truncated: opinionText.text.length > 4000, url: opinionText.url } : null,
    usage: { used: gate.used ?? null, limit: gate.limit ?? null },
  });
}
