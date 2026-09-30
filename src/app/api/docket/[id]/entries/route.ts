import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json } from "@/lib/api/http";
import { requireFeature } from "@/lib/billing/entitlements";
import { getPrimaryProvider } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Next page of docket entries. The docket itself was already metered when first opened. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return apiError(400, "invalid_id", "Invalid docket id.");
  const cursor = new URL(req.url).searchParams.get("cursor");
  if (cursor && !/^[A-Za-z0-9+/=_%-]{1,512}$/.test(cursor)) return apiError(400, "invalid_cursor", "Invalid cursor.");
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "docketDetails");
  if (!gate.allowed) return gateError(gate);
  const res = await getPrimaryProvider().getDocketEntries(id, cursor, { requestId: `entries-${id}`, userId: viewer.userId, plan: viewer.plan });
  if (!res.ok) return apiError(res.error.code === "quota" ? 503 : 502, res.error.code, res.error.message);
  return json(res.data);
}
