import "server-only";
import { getEnv } from "@/lib/config/env";
import type { PlanId } from "@/lib/config/plans";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Viewer } from "@/lib/auth/session";
import { getStripe, priceIdForPlan } from "./stripe";

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "no_price" | "unauthenticated" | "stripe_error",
  ) {
    super(message);
  }
}

async function ensureCustomer(viewer: Viewer): Promise<string> {
  const stripe = getStripe();
  const admin = getSupabaseAdmin();
  if (!stripe || !admin || !viewer.userId) throw new BillingError("Billing is not configured.", "not_configured");
  const { data: profile } = await admin.from("profiles").select("stripe_customer_id, email").eq("id", viewer.userId).maybeSingle();
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;
  const customer = await stripe.customers.create({ email: viewer.email ?? profile?.email ?? undefined, metadata: { user_id: viewer.userId } });
  await admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", viewer.userId);
  return customer.id;
}

async function hadTrialBefore(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { count } = await admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return (count ?? 0) > 0;
}

export async function createCheckoutSession(viewer: Viewer, plan: PlanId, returnTo: string | null): Promise<string> {
  if (!viewer.userId || viewer.demo) throw new BillingError("Create an account to subscribe.", "unauthenticated");
  const stripe = getStripe();
  if (!stripe) throw new BillingError("Stripe is not configured (STRIPE_SECRET_KEY).", "not_configured");
  const price = priceIdForPlan(plan);
  if (!price) throw new BillingError(`No Stripe price configured for plan "${plan}".`, "no_price");
  const env = getEnv();
  const customer = await ensureCustomer(viewer);
  const trialDays = env.STRIPE_TRIAL_DAYS > 0 && !(await hadTrialBefore(viewer.userId)) ? env.STRIPE_TRIAL_DAYS : undefined;
  const site = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const safeReturn = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/app";
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: viewer.userId,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: {
        ...(trialDays ? { trial_period_days: trialDays } : {}),
        metadata: { user_id: viewer.userId, plan_id: plan },
      },
      metadata: { user_id: viewer.userId, plan_id: plan },
      success_url: `${site}/app/billing?status=success&next=${encodeURIComponent(safeReturn)}`,
      cancel_url: `${site}/pricing?status=canceled`,
    });
    if (!session.url) throw new BillingError("Stripe did not return a checkout URL.", "stripe_error");
    return session.url;
  } catch (e) {
    if (e instanceof BillingError) throw e;
    throw new BillingError(e instanceof Error ? e.message : "Stripe error", "stripe_error");
  }
}

export async function createPortalSession(viewer: Viewer): Promise<string> {
  if (!viewer.userId || viewer.demo) throw new BillingError("Sign in to manage billing.", "unauthenticated");
  const stripe = getStripe();
  if (!stripe) throw new BillingError("Stripe is not configured.", "not_configured");
  const customer = await ensureCustomer(viewer);
  const site = getEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${site}/app/billing` });
  return portal.url;
}
