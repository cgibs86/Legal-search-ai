import { getViewer } from "@/lib/auth/session";
import { apiError, json } from "@/lib/api/http";
import { BillingError, createPortalSession } from "@/lib/billing/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const viewer = await getViewer();
  try {
    return json({ url: await createPortalSession(viewer) });
  } catch (e) {
    if (e instanceof BillingError) return apiError(e.code === "unauthenticated" ? 401 : 503, e.code, e.message);
    return apiError(500, "portal_failed", "Could not open the billing portal.");
  }
}
