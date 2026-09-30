import type { DeliveredHit, MaskedHit, PaywallState, PaywallVariant, ResultSummary, SearchHit } from "@/lib/domain/types";
import type { PlanId } from "@/lib/config/plans";
import { getPlan } from "@/lib/config/plans";

/**
 * Configurable paywall. Masking happens on the server: locked results are never sent to
 * the browser, so the blur cannot be bypassed with developer tools.
 *
 *   A — every detailed result masked
 *   B — first result fully visible, the rest masked
 *   C — basic case metadata visible; match details, parties, documents and intelligence locked
 */

export const PAYWALL_COOKIE = "lsa_pw";
export const VARIANTS: PaywallVariant[] = ["A", "B", "C"];

export function parseWeights(spec: string): Record<PaywallVariant, number> {
  const out: Record<PaywallVariant, number> = { A: 0, B: 0, C: 0 };
  for (const part of spec.split(",")) {
    const [k, v] = part.split(":").map((s) => s.trim());
    if ((VARIANTS as string[]).includes(k)) out[k as PaywallVariant] = Math.max(0, Number(v) || 0);
  }
  if (out.A + out.B + out.C === 0) out.A = 1;
  return out;
}

/** Picks a variant: fixed via config, or weighted random (then persisted in a cookie by the caller). */
export function chooseVariant(config: "A" | "B" | "C" | "split", weightsSpec: string, existing: string | undefined, rand: () => number = Math.random): PaywallVariant {
  if (config !== "split") return config;
  if (existing && (VARIANTS as string[]).includes(existing)) return existing as PaywallVariant;
  const w = parseWeights(weightsSpec);
  const total = w.A + w.B + w.C;
  let r = rand() * total;
  for (const v of VARIANTS) {
    if (r < w[v]) return v;
    r -= w[v];
  }
  return "A";
}

function yearOf(h: SearchHit): string | null {
  const d = h.record.dateFiled ?? h.record.opinions[0]?.dateFiled ?? h.record.lastActivity ?? h.record.documents[0]?.date;
  return d ? d.slice(0, 4) : null;
}

export function maskHit(h: SearchHit, index: number, withBasic: boolean): MaskedHit {
  return {
    id: `locked-${index}`,
    masked: true,
    court: { level: h.record.court.level, state: h.record.court.state, type: h.record.court.type },
    year: yearOf(h),
    kinds: h.record.kinds,
    matchTypes: h.match.types,
    basic: withBasic
      ? {
          caseName: h.record.caseName,
          courtName: h.record.court.citation ?? h.record.court.name,
          docketNumber: h.record.docketNumber,
          dateFiled: h.record.dateFiled ?? h.record.opinions[0]?.dateFiled ?? null,
        }
      : null,
  };
}

export function applyPaywall(hits: SearchHit[], plan: PlanId, signedIn: boolean, variant: PaywallVariant): { hits: DeliveredHit[]; state: PaywallState } {
  if (getPlan(plan).features.fullResults) {
    return { hits, state: { variant, locked: false, unlockedCount: hits.length, reason: "none" } };
  }
  const reason = signedIn ? "no_plan" : "anonymous";
  if (variant === "B") {
    const delivered: DeliveredHit[] = hits.map((h, i) => (i === 0 ? h : maskHit(h, i, false)));
    return { hits: delivered, state: { variant, locked: hits.length > 1, unlockedCount: Math.min(1, hits.length), reason } };
  }
  const withBasic = variant === "C";
  return { hits: hits.map((h, i) => maskHit(h, i, withBasic)), state: { variant, locked: hits.length > 0, unlockedCount: 0, reason } };
}

/** For locked results, keep the aggregate summary but drop per-court detail. */
export function lockedSummary(summary: ResultSummary): ResultSummary {
  return { ...summary, courts: [] };
}
