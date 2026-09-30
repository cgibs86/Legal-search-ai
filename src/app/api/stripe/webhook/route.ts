import type Stripe from "stripe";
import { getEnv } from "@/lib/config/env";
import { getStripe, planForPriceId } from "@/lib/billing/stripe";
import { handleStripeEvent, type WebhookDeps } from "@/lib/billing/webhook";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { trackEvent } from "@/lib/analytics/track";
import { log, errorMessage } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. The raw body is verified against STRIPE_WEBHOOK_SECRET before anything
 * is processed; unsigned or tampered requests are rejected with 400.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  const db = getSupabaseAdmin();
  if (!stripe || !secret || !db) return new Response("Billing not configured", { status: 503 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (e) {
    log.warn("stripe.webhook_bad_signature", { error: errorMessage(e) });
    return new Response("Invalid signature", { status: 400 });
  }

  const deps: WebhookDeps = {
    async markEventProcessed(id, type) {
      const { error } = await db.from("stripe_events").insert({ id, type });
      if (error && error.code === "23505") return false;
      if (error) throw new Error(error.message);
      return true;
    },
    async upsertSubscription(row) {
      const { error } = await db.from("subscriptions").upsert(row);
      if (error) throw new Error(error.message);
    },
    async findUserIdByCustomer(customerId) {
      const { data } = await db.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
      return data?.id ?? null;
    },
    async setCustomerForUser(userId, customerId) {
      await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId).is("stripe_customer_id", null);
    },
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    planForPriceId,
    track: (name, userId, props) => trackEvent(name, { userId, props }),
  };

  try {
    const outcome = await handleStripeEvent(event, deps);
    log.info("stripe.webhook", { type: event.type, handled: outcome.handled, note: outcome.note });
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    // Undo the idempotency marker so Stripe's retry can reprocess the event.
    await db.from("stripe_events").delete().eq("id", event.id);
    log.error("stripe.webhook_failed", { type: event.type, error: errorMessage(e) });
    return new Response("Webhook handler failed", { status: 500 });
  }
}
