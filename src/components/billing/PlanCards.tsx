import { Check } from "lucide-react";
import { PAID_PLAN_IDS, PLANS, type PlanId } from "@/lib/config/plans";
import { Badge, ButtonLink } from "@/components/ui/primitives";
import { CheckoutButton } from "./BillingButtons";
import { cn } from "@/lib/utils";

/**
 * Plan cards rendered from `PLANS` (the single source of pricing). Used on /pricing,
 * the landing page and /app/billing.
 */
export function PlanCards({ currentPlan, signedIn, demo, returnTo, showFree = false, trialDays }: { currentPlan: PlanId; signedIn: boolean; demo: boolean; returnTo?: string; showFree?: boolean; trialDays?: number }) {
  const ids: PlanId[] = showFree ? ["free", ...PAID_PLAN_IDS] : PAID_PLAN_IDS;
  return (
    <div className={cn("grid gap-4", showFree ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3")}>
      {ids.map((id) => {
        const p = PLANS[id];
        const current = id === currentPlan;
        return (
          <div key={id} className={cn("relative flex flex-col rounded-2xl border bg-elev p-5 shadow-card", p.recommended ? "border-accent/60 ring-1 ring-accent/30" : "border-line")}>
            {p.recommended ? (
              <div className="absolute -top-2.5 left-5">
                <Badge tone="accent" className="bg-accent text-accent-fg">Recommended</Badge>
              </div>
            ) : null}
            <div className="text-sm font-semibold">{p.name}</div>
            <div className="mt-1 text-xs text-muted">{p.tagline}</div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-tight">${p.priceMonthlyUsd}</span>
              <span className="text-sm text-muted">/ month</span>
            </div>
            <ul className="mt-4 flex-1 space-y-2">
              {p.highlights.map((h) => (
                <li key={h} className="flex gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5">
              {current ? (
                <div className="flex h-10 items-center justify-center rounded-xl border border-line text-sm text-muted">Your current plan</div>
              ) : id === "free" ? (
                <ButtonLink href="/search" variant="secondary" className="w-full justify-center">
                  Start searching
                </ButtonLink>
              ) : demo ? (
                <div className="flex h-10 items-center justify-center rounded-xl border border-dashed border-line text-center text-xs text-subtle">Demo workspace — switch plans at /demo</div>
              ) : (
                <CheckoutButton plan={id as Exclude<PlanId, "free">} signedIn={signedIn} returnTo={returnTo} variant={p.recommended ? "primary" : "secondary"} className="w-full justify-center" label={trialDays && !signedIn ? `Start ${trialDays}-day trial` : `Choose ${p.name}`} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
