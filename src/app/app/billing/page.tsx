import type { Metadata } from "next";
import { getViewer } from "@/lib/auth/session";
import { features, getEnv } from "@/lib/config/env";
import { getPlan } from "@/lib/config/plans";
import { PlanCards } from "@/components/billing/PlanCards";
import { PortalButton } from "@/components/billing/BillingButtons";
import { Badge, Card, Notice, SectionLabel } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await props.searchParams;
  const viewer = await getViewer();
  const plan = getPlan(viewer.plan);
  const sub = viewer.subscription;
  const stripeReady = features.stripe();
  // Only same-site relative paths are followed after checkout.
  const next = sp.next && /^\/(?!\/)[\w\-/?=&%.]*$/.test(sp.next) && sp.next !== "/app/billing" ? sp.next : null;
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Account</SectionLabel>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Billing</h1>
      </div>
      {sp.status === "success" ? (
        <Notice tone="emerald" title="Payment received" action={next ? <a href={next} className="text-sm font-medium text-accent hover:underline">Continue →</a> : undefined}>
          Your plan activates as soon as Stripe confirms the subscription (usually a few seconds). Refresh if it still shows the old plan.
        </Notice>
      ) : null}
      {viewer.demo ? (
        <Notice tone="amber" title="Demo workspace">
          Billing is simulated here — switch plans at /demo. With Supabase and Stripe configured, this page runs real Stripe Checkout and the customer portal.
        </Notice>
      ) : !stripeReady ? (
        <Notice tone="amber" title="Billing not configured">
          This server has no Stripe keys (STRIPE_SECRET_KEY and price IDs). Plans can&apos;t be purchased until they are set.
        </Notice>
      ) : null}
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-subtle">Current plan</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold">{plan.name}</span>
            {plan.priceMonthlyUsd ? <span className="text-sm text-muted">${plan.priceMonthlyUsd}/month</span> : null}
            {sub ? <Badge tone={sub.status === "active" || sub.status === "trialing" ? "emerald" : "amber"}>{sub.status.replace("_", " ")}</Badge> : null}
          </div>
          <div className="mt-1 text-sm text-muted">
            {sub?.status === "trialing" && sub.trialEnd ? `Trial ends ${formatDate(sub.trialEnd)}. ` : ""}
            {sub?.currentPeriodEnd ? (sub.cancelAtPeriodEnd ? `Access ends ${formatDate(sub.currentPeriodEnd)}.` : `Renews ${formatDate(sub.currentPeriodEnd)}.`) : viewer.plan === "free" ? "No active subscription." : ""}
            {sub?.status === "past_due" ? " Payment failed — update your card to keep access." : ""}
          </div>
        </div>
        {sub && !viewer.demo && stripeReady ? <PortalButton /> : null}
      </Card>
      <PlanCards currentPlan={viewer.plan} signedIn={Boolean(viewer.userId)} demo={viewer.demo} returnTo="/app/billing" trialDays={getEnv().STRIPE_TRIAL_DAYS} />
      <p className="text-xs text-subtle">Prices in USD, billed monthly. Cancel anytime from the billing portal; access continues to the end of the paid period. Taxes may apply.</p>
    </div>
  );
}
