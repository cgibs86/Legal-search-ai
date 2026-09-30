import { getViewer, can } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { anonIdFrom, ANON_COOKIE, apiError, json, parseBody, readCookie } from "@/lib/api/http";
import { SearchBodySchema } from "@/lib/api/schemas";
import { InvalidSearchError } from "@/lib/search/orchestrator";
import { identityFor, searchForViewer } from "@/lib/search/service";
import { applyPaywall, chooseVariant, lockedSummary, PAYWALL_COOKIE } from "@/lib/paywall/paywall";
import { limitSearch, looksAutomated } from "@/lib/security/ratelimit";
import { getRepo } from "@/lib/data/repo";
import { trackEvent } from "@/lib/analytics/track";
import { log, errorMessage } from "@/lib/log";
import type { SearchResponse } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.userId && looksAutomated(req.headers)) {
    return apiError(403, "automated", "Automated access is not permitted. Contact us about API access.");
  }
  const body = await parseBody(req, SearchBodySchema);
  if (!body.ok) return body.response;

  const rl = await limitSearch(viewer, req.headers);
  if (!rl.allowed) {
    return apiError(429, "rate_limited", viewer.userId ? "Hourly search limit for your plan reached." : "Search limit reached. Create a free account or try again shortly.", { resetAt: rl.resetAt });
  }

  const anon = anonIdFrom(req);
  const env = getEnv();
  const existingVariant = readCookie(req, PAYWALL_COOKIE);
  const variant = chooseVariant(env.PAYWALL_VARIANT, env.PAYWALL_WEIGHTS, existingVariant);
  trackEvent("search_started", { userId: viewer.userId, anonId: anon.id, props: { page: body.data.pageToken ? "next" : "first" } });

  try {
    const result = await searchForViewer(viewer, body.data);
    const identityFull = await identityFor(viewer, result);
    const identity = can(viewer, "identityResolution") ? identityFull : { locked: true as const, clusterCount: identityFull.clusters.length };
    const paywall = applyPaywall(result.hits, viewer.plan, Boolean(viewer.userId), variant);

    const response: SearchResponse = {
      searchId: result.searchId,
      query: result.query,
      classification: result.classification,
      variants: result.variants,
      status: result.status,
      hits: paywall.hits,
      summary: paywall.state.locked ? lockedSummary(result.summary) : result.summary,
      coverage: result.coverage,
      providerStatuses: result.providerStatuses,
      paywall: paywall.state,
      identity,
      nextPageToken: paywall.state.locked ? null : result.nextPageToken,
      dataMode: result.dataMode,
      ambiguity: result.ambiguity,
      tookMs: result.tookMs,
    };

    if (viewer.userId && !body.data.pageToken) {
      const repo = await getRepo(viewer);
      await repo?.logSearch({ entityType: result.entityType, query: result.query, filters: body.data.filters, resultCount: result.hits.length, status: result.status, dataMode: result.dataMode }).catch(() => undefined);
    }
    trackEvent("search_completed", { userId: viewer.userId, anonId: anon.id, props: { entity_type: result.entityType, status: result.status, hits: result.hits.length, data_mode: result.dataMode } });
    if (result.hits.length) trackEvent("results_found", { userId: viewer.userId, anonId: anon.id, props: { hits: result.hits.length } });
    if (paywall.state.locked) trackEvent("paywall_viewed", { userId: viewer.userId, anonId: anon.id, props: { variant, hits: result.hits.length } });

    const res = json({ ...response, suggestedVariants: result.suggestedVariants, entityType: result.entityType, error: result.error });
    if (!existingVariant && env.PAYWALL_VARIANT === "split") res.cookies.set(PAYWALL_COOKIE, variant, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" });
    if (anon.isNew) res.cookies.set(ANON_COOKIE, anon.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
    return res;
  } catch (e) {
    if (e instanceof InvalidSearchError) return apiError(400, "invalid_query", e.message);
    log.error("search.failed", { error: errorMessage(e) });
    return apiError(500, "search_failed", "Search failed unexpectedly. Please try again.");
  }
}
