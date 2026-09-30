import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { anonIdFrom, ANON_COOKIE, apiError, json, parseBody } from "@/lib/api/http";
import { isAnalyticsEvent } from "@/lib/analytics/events";
import { trackEvent } from "@/lib/analytics/track";
import { hashIp, clientIp, rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().max(60), props: z.record(z.string(), z.union([z.string().max(80), z.number(), z.boolean(), z.null()])).optional() });

/** First-party funnel events from the browser. Allow-listed names only; no session recording. */
export async function POST(req: Request) {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  if (!isAnalyticsEvent(body.data.name)) return apiError(400, "unknown_event", "Unknown event.");
  const rl = await rateLimit(`events:${hashIp(clientIp(req.headers))}`, 60, 60);
  if (!rl.allowed) return json({ ok: false }, { status: 429 });
  const viewer = await getViewer();
  const anon = anonIdFrom(req);
  trackEvent(body.data.name, { userId: viewer.userId, anonId: anon.id, props: body.data.props });
  const res = json({ ok: true });
  if (anon.isNew) res.cookies.set(ANON_COOKIE, anon.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return res;
}
