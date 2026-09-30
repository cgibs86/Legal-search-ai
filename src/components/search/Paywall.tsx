"use client";

import { motion } from "motion/react";
import { ArrowRight, CheckCircle2, Lock } from "lucide-react";
import type { PaywallState, ResultSummary } from "@/lib/domain/types";
import { ButtonLink } from "@/components/ui/primitives";
import { LEVEL_LABEL, MATCH_META } from "@/lib/ui/labels";
import { formatDate, formatNumber } from "@/lib/utils";
import { PLANS } from "@/lib/config/plans";

/** Overlay that sits on top of masked results. Copy adapts to the paywall variant. */
export function PaywallOverlay({ state, summary, returnTo, authEnabled }: { state: PaywallState; summary: ResultSummary; returnTo: string; authEnabled: boolean }) {
  const cta = !authEnabled ? "/demo" : state.reason === "anonymous" ? `/signup?next=${encodeURIComponent(returnTo)}` : `/pricing?next=${encodeURIComponent(returnTo)}`;
  const locked = summary.total - state.unlockedCount;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative z-10 mx-auto -mt-2 w-full max-w-xl">
      <div className="rounded-3xl border border-accent/30 bg-elev/95 p-6 text-center shadow-float backdrop-blur-xl sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent animate-pulse-ring">
          <Lock className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Unlock the full court history</h2>
        <p className="mt-2 text-sm text-muted">
          {formatNumber(locked)} {locked === 1 ? "record is" : "records are"} ready
          {summary.dateRange.from ? ` from ${formatDate(summary.dateRange.from, { year: "numeric" })}` : ""}
          {summary.dateRange.to ? ` to ${formatDate(summary.dateRange.to, { year: "numeric" })}` : ""}.{" "}
          {state.variant === "C" ? "Case names are visible — parties, match evidence, mentions and sources are locked." : "See every case, party role, filing and mention."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
          {(Object.keys(summary.byMatchType) as (keyof typeof summary.byMatchType)[])
            .filter((k) => summary.byMatchType[k] > 0)
            .map((k) => (
              <span key={k} className="rounded-lg border border-line bg-elev-2 px-2 py-1 text-muted">
                {summary.byMatchType[k]} {MATCH_META[k].label.toLowerCase()}
              </span>
            ))}
          {summary.jurisdictions.map((j) => (
            <span key={j.level} className="rounded-lg border border-line bg-elev-2 px-2 py-1 text-muted">
              {j.count} {LEVEL_LABEL[j.level].toLowerCase()}
            </span>
          ))}
        </div>
        <ul className="mx-auto mt-5 grid max-w-sm gap-1.5 text-left text-sm text-muted">
          {["Full case, docket and party details", "Why each record matched — and how strongly", "Docket viewer with filings and orders", "Monitoring alerts when new records appear"].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald" /> {f}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col items-center gap-2">
          <ButtonLink href={cta} size="lg" className="w-full justify-center sm:w-auto">
            View Full Results <ArrowRight className="h-4 w-4" />
          </ButtonLink>
          <div className="text-xs text-subtle">
            Plans from ${PLANS.search.priceMonthlyUsd}/month · cancel anytime
          </div>
        </div>
      </div>
    </motion.div>
  );
}
