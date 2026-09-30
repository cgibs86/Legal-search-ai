import "server-only";
import Stripe from "stripe";
import { getEnv } from "@/lib/config/env";
import type { PlanId } from "@/lib/config/plans";

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripe) stripe = new Stripe(key, { appInfo: { name: "Legal Search AI", version: "1.0.0" } });
  return stripe;
}

/** Stripe price IDs live in env so prices can change without code changes. */
export function priceIdForPlan(plan: PlanId): string | null {
  const env = getEnv();
  switch (plan) {
    case "search":
      return env.STRIPE_PRICE_SEARCH ?? null;
    case "research_pro":
      return env.STRIPE_PRICE_RESEARCH_PRO ?? null;
    case "intelligence":
      return env.STRIPE_PRICE_INTELLIGENCE ?? null;
    default:
      return null;
  }
}

export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const plan of ["search", "research_pro", "intelligence"] as PlanId[]) {
    if (priceIdForPlan(plan) === priceId) return plan;
  }
  return null;
}
