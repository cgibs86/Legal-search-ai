import { cookies } from "next/headers";
import { z } from "zod";
import { DEMO_COOKIE, DEMO_ID_COOKIE, getViewer } from "@/lib/auth/session";
import { dropMemoryStore } from "@/lib/data/memoryRepo";
import { apiError, json, parseBody } from "@/lib/api/http";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing/stripe";
import { log, errorMessage } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ scope: z.enum(["history", "account"]), confirm: z.string().optional() });

/**
 * DELETE { scope: "history" }  → removes the viewer's search history (saved searches are kept)
 * DELETE { scope: "account", confirm: "DELETE" } → cancels Stripe subscriptions immediately
 *   and deletes the auth user; every user-owned row cascades from profiles.
 */
export async function DELETE(req: Request) {
  const viewer = await getViewer();
  if (!viewer.userId) return apiError(401, "sign_in", "Sign in first.");
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;

  if (viewer.demo) {
    if (body.data.scope === "account") {
      const jar = await cookies();
      jar.delete(DEMO_COOKIE);
      jar.delete(DEMO_ID_COOKIE);
      dropMemoryStore(viewer.userId);
    }
    return json({ ok: true, demo: true });
  }

  if (body.data.scope === "history") {
    const db = await createSupabaseServer();
    if (!db) return apiError(503, "not_configured", "Not configured.");
    const { error } = await db.from("searches").delete().eq("user_id", viewer.userId).eq("saved", false);
    if (error) return apiError(500, "delete_failed", "Could not clear history.");
    return json({ ok: true });
  }

  if (body.data.confirm !== "DELETE") return apiError(400, "confirm_required", 'Type DELETE to confirm.');
  const admin = getSupabaseAdmin();
  if (!admin) return apiError(503, "not_configured", "Account deletion needs SUPABASE_SERVICE_ROLE_KEY on the server.");

  const stripe = getStripe();
  const { data: subs } = await admin.from("subscriptions").select("id, status").eq("user_id", viewer.userId);
  for (const s of subs ?? []) {
    if (!stripe || ["canceled", "incomplete_expired"].includes(s.status)) continue;
    try {
      await stripe.subscriptions.cancel(s.id);
    } catch (e) {
      log.error("account.cancel_subscription_failed", { error: errorMessage(e) });
      return apiError(502, "billing_error", "We couldn't cancel your subscription automatically. Cancel it in Billing first, then delete your account.");
    }
  }
  const { error } = await admin.auth.admin.deleteUser(viewer.userId);
  if (error) {
    log.error("account.delete_failed", { error: error.message });
    return apiError(500, "delete_failed", "Could not delete the account. Contact support.");
  }
  const db = await createSupabaseServer();
  await db?.auth.signOut().catch(() => undefined);
  return json({ ok: true });
}
