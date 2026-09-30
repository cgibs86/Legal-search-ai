import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json } from "@/lib/api/http";
import { requireFeature } from "@/lib/billing/entitlements";
import { checkWatchNow, MANUAL_CHECKS_PER_HOUR } from "@/lib/radar/runner";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Case Radar "Check now" for a single watch the viewer owns. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return apiError(400, "invalid_id", "Invalid watch id.");
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "docketDetails");
  if (!gate.allowed) return gateError(gate);
  const rl = await rateLimit(`radar-check:${viewer.userId}`, 3600, MANUAL_CHECKS_PER_HOUR[viewer.plan]);
  if (!rl.allowed) return apiError(429, "rate_limited", `Manual checks are limited to ${MANUAL_CHECKS_PER_HOUR[viewer.plan]} per hour on your plan. Scheduled checks continue automatically.`, { resetAt: rl.resetAt });
  const res = await checkWatchNow({ userId: viewer.userId!, plan: viewer.plan, demo: viewer.demo }, id);
  if (!res.ok) return apiError(res.code === "not_found" ? 404 : res.code === "budget" ? 503 : res.code === "not_configured" ? 503 : 502, res.code, res.message);
  return json(res);
}
