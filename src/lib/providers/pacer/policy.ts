import type { PlanId } from "@/lib/config/plans";

/**
 * Server-side usage policy for paid PACER traffic. Nothing calls PACER unless every rule
 * here passes. Defaults are deliberately closed: with PACER_MAX_DAILY_SPEND_USD=0 no paid
 * request is ever sent.
 */

export const PCL_RESULTS_PER_PAGE = 54;

/**
 * PACER fee per billable PCL page. $0.10 through 2026-12-31; $0.12 from 2027-01-01
 * (temporary increase announced 2026-06-26, effective for five years).
 */
export function pacerFeePerPageUsd(on: Date = new Date()): number {
  return on >= new Date("2027-01-01T00:00:00Z") ? 0.12 : 0.1;
}

export interface PacerPolicyInput {
  enabled: boolean;
  configured: boolean;
  userRequested: boolean;
  plan: PlanId;
  allowedPlans: string[];
  maxDailySpendUsd: number;
  requestedPages: number;
  maxPagesPerSearch: number;
}

export type PacerPolicyDecision =
  | { allowed: true; pages: number; estimatedCostUsd: number }
  | { allowed: false; reason: string };

export function evaluatePacerPolicy(i: PacerPolicyInput, now = new Date()): PacerPolicyDecision {
  if (!i.enabled) return { allowed: false, reason: "PACER integration is disabled (PACER_ENABLED is not true)." };
  if (!i.configured) return { allowed: false, reason: "PACER credentials are not configured." };
  if (!i.userRequested) return { allowed: false, reason: "PACER searches run only when a user explicitly requests them." };
  if (!i.allowedPlans.includes(i.plan)) return { allowed: false, reason: `Direct PACER searches are available on: ${i.allowedPlans.join(", ")}.` };
  if (i.maxDailySpendUsd <= 0) return { allowed: false, reason: "PACER daily spend cap is $0 (PACER_MAX_DAILY_SPEND_USD)." };
  const pages = Math.max(1, Math.min(i.requestedPages, i.maxPagesPerSearch));
  return { allowed: true, pages, estimatedCostUsd: Number((pages * pacerFeePerPageUsd(now)).toFixed(2)) };
}

export const PCL_PARTY_ROLES: Record<string, string> = {
  pla: "Plaintiff",
  dft: "Defendant",
  db: "Debtor",
  cr: "Creditor",
  pet: "Petitioner",
  res: "Respondent",
  apl: "Appellant",
  ape: "Appellee",
  intv: "Intervenor",
  "3pd": "Third-party defendant",
  "3pp": "Third-party plaintiff",
  ccl: "Counter-claimant",
  cd: "Counter-defendant",
  tr: "Trustee",
  ust: "U.S. Trustee",
};

/** PCL court ids ("ilndc", "laebk") to CourtListener ids ("ilnd", "laeb"). */
export function pclCourtToCourtListener(courtId: string): string {
  const m = courtId.toLowerCase().match(/^([a-z]+?)(dc|bk)$/);
  if (!m) return courtId.toLowerCase();
  return m[2] === "bk" ? `${m[1]}b` : m[1];
}
