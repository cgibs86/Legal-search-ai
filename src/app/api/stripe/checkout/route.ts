import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, json, parseBody } from "@/lib/api/http";
import { BillingError, createCheckoutSession } from "@/lib/billing/checkout";
import { trackEvent } from "@/lib/analytics/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ plan: z.enum(["search", "research_pro", "intelligence"]), returnTo: z.string().max(500).nullish() });

export async function POST(req: Request) {
  const viewer = await getViewer();
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  if (!viewer.userId || viewer.demo) return apiError(401, "sign_in", viewer.demo ? "The demo workspace can't purchase plans. Configure Supabase and Stripe for real billing." : "Create an account to subscribe.");
  trackEvent("checkout_started", { userId: viewer.userId, props: { plan: body.data.plan } });
  try {
    const url = await createCheckoutSession(viewer, body.data.plan, body.data.returnTo ?? null);
    return json({ url });
  } catch (e) {
    if (e instanceof BillingError) return apiError(e.code === "unauthenticated" ? 401 : e.code === "stripe_error" ? 502 : 503, e.code, e.message);
    return apiError(500, "checkout_failed", "Could not start checkout.");
  }
}
