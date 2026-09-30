import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json } from "@/lib/api/http";
import { meterRecordView } from "@/lib/billing/entitlements";
import { getPrimaryProvider } from "@/lib/providers/registry";
import { trackEvent } from "@/lib/analytics/track";
import { countUsage } from "@/lib/usage/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return apiError(400, "invalid_id", "Invalid docket id.");
  const viewer = await getViewer();
  const gate = await meterRecordView(viewer, `docket:${id}`);
  if (!gate.allowed) return gateError(gate);
  const res = await getPrimaryProvider().getDocket(id, { requestId: `docket-${id}`, userId: viewer.userId, plan: viewer.plan });
  if (!res.ok) {
    const status = res.error.code === "not_found" ? 404 : res.error.code === "quota" ? 503 : res.error.code === "timeout" ? 504 : 502;
    return apiError(status, res.error.code, res.error.message);
  }
  if (viewer.userId && (await countUsage(viewer.userId, "record_view", "1970-01-01T00:00:00Z").catch(() => 2)) <= 1) {
    trackEvent("first_result_opened", { userId: viewer.userId });
  }
  return json({ detail: res.data, usage: { used: gate.used ?? null, limit: gate.limit ?? null } });
}
