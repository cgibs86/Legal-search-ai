import type Stripe from "stripe";
import type { PlanId } from "@/lib/config/plans";

/**
 * Stripe webhook business logic, separated from I/O so it can be unit-tested with fake
 * stores. The route handler verifies the signature before calling this.
 */

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: PlanId;
  status: string;
  stripe_customer_id: string;
  stripe_price_id: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
}

export interface WebhookDeps {
  /** Returns false when the event was already processed (idempotency). */
  markEventProcessed(eventId: string, type: string): Promise<boolean>;
  upsertSubscription(row: SubscriptionRow): Promise<void>;
  findUserIdByCustomer(customerId: string): Promise<string | null>;
  setCustomerForUser(userId: string, customerId: string): Promise<void>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  planForPriceId(priceId: string | null | undefined): PlanId | null;
  track(name: string, userId: string | null, props: Record<string, unknown>): void;
}

export type WebhookOutcome = { handled: boolean; note: string };

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

function customerId(c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

export async function subscriptionToRow(sub: Stripe.Subscription, deps: WebhookDeps, fallbackUserId?: string | null): Promise<SubscriptionRow | null> {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const plan = deps.planForPriceId(priceId) ?? ((sub.metadata?.plan_id as PlanId | undefined) ?? null);
  if (!plan || plan === "free") return null;
  const cust = customerId(sub.customer);
  if (!cust) return null;
  const userId = (sub.metadata?.user_id as string | undefined) || fallbackUserId || (await deps.findUserIdByCustomer(cust));
  if (!userId) return null;
  return {
    id: sub.id,
    user_id: userId,
    plan_id: plan,
    status: sub.status,
    stripe_customer_id: cust,
    stripe_price_id: priceId,
    current_period_end: iso(item?.current_period_end ?? null),
    trial_end: iso(sub.trial_end),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: iso(sub.canceled_at),
  };
}

export async function handleStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<WebhookOutcome> {
  const fresh = await deps.markEventProcessed(event.id, event.type);
  if (!fresh) return { handled: false, note: "duplicate event" };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) return { handled: false, note: "not a subscription checkout" };
      const userId = session.client_reference_id ?? (session.metadata?.user_id as string | undefined) ?? null;
      const cust = customerId(session.customer as string | Stripe.Customer | null);
      if (userId && cust) await deps.setCustomerForUser(userId, cust);
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const sub = await deps.retrieveSubscription(subId);
      const row = await subscriptionToRow(sub, deps, userId);
      if (!row) return { handled: false, note: "could not map subscription to a plan/user" };
      await deps.upsertSubscription(row);
      deps.track("subscription_activated", row.user_id, { plan: row.plan_id, status: row.status });
      return { handled: true, note: `subscription ${row.status}` };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const sub = event.data.object as Stripe.Subscription;
      const row = await subscriptionToRow(sub, deps);
      if (!row) return { handled: false, note: "could not map subscription to a plan/user" };
      await deps.upsertSubscription(row);
      if (event.type === "customer.subscription.deleted" || row.status === "canceled") deps.track("subscription_canceled", row.user_id, { plan: row.plan_id });
      return { handled: true, note: `subscription ${row.status}` };
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      deps.track("payment_failed", null, { customer: customerId(invoice.customer as string | null) });
      return { handled: true, note: "payment failure recorded; access follows subscription status" };
    }
    default:
      return { handled: false, note: `ignored ${event.type}` };
  }
}
