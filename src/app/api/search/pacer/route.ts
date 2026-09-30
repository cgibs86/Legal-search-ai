import { getViewer } from "@/lib/auth/session";
import { apiError, json, parseBody } from "@/lib/api/http";
import { SearchBodySchema } from "@/lib/api/schemas";
import { getPacerProvider } from "@/lib/providers/registry";
import { classifyQuery, validateQuery } from "@/lib/search/classify";
import { buildVariants } from "@/lib/search/variants";
import { classifyHit, toSearchHit } from "@/lib/search/match";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit, user-initiated PACER Case Locator search (paid). Never called automatically.
 * The PACER policy (plan, daily spend cap, pages per search) is enforced inside the adapter.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.userId) return apiError(401, "sign_in", "Sign in to run PACER searches.");
  const body = await parseBody(req, SearchBodySchema);
  if (!body.ok) return body.response;
  const valid = validateQuery(body.data.query);
  if (!valid.valid) return apiError(400, "invalid_query", valid.reason);
  const rl = await rateLimit(`pacer:${viewer.userId}`, 3600, 10);
  if (!rl.allowed) return apiError(429, "rate_limited", "PACER search limit reached for this hour.", { resetAt: rl.resetAt });

  const cls = classifyQuery(valid.query);
  const entityType = body.data.entityType ?? cls.primary;
  const variants = buildVariants(valid.query, entityType, false);
  const res = await getPacerProvider().searchDockets(
    { raw: valid.query, entityType, variants, docketNumber: cls.docketNumber?.raw ?? null, filters: body.data.filters, sort: body.data.sort, pageSize: 54 },
    { requestId: `pacer-${viewer.userId}`, userId: viewer.userId, plan: viewer.plan, allowPaid: true },
  );
  if (!res.ok) return apiError(res.error.code === "policy_blocked" || res.error.code === "not_configured" ? 403 : res.error.code === "quota" ? 429 : 502, res.error.code, res.error.message);
  const hits = res.data.hits
    .map((h, i) => {
      const m = classifyHit(h, { entityType, variants, docketNumber: cls.docketNumber?.raw ?? null });
      return m ? toSearchHit(h, m, i) : null;
    })
    .filter(Boolean);
  return json({ source: { label: res.data.label, message: res.data.message, totalCount: res.data.totalCount, costUsd: res.data.costUsd ?? 0, cached: res.data.cached }, hits });
}
