import "server-only";
import { getPlan, minimumPlanFor, type FeatureKey, type PlanLimits } from "@/lib/config/plans";
import type { Viewer } from "@/lib/auth/session";
import { countUsage, hasUsageForSubject, monthStartIso, recordUsage, type UsageKind } from "@/lib/usage/events";

export type Gate =
  | { allowed: true; used?: number; limit?: number }
  | { allowed: false; reason: "sign_in" | "upgrade" | "limit"; message: string; requiredPlan?: string; used?: number; limit?: number };

export function requireFeature(viewer: Viewer, feature: FeatureKey): Gate {
  if (getPlan(viewer.plan).features[feature]) return { allowed: true };
  const needed = minimumPlanFor(feature);
  if (!viewer.userId) return { allowed: false, reason: "sign_in", message: `Create an account and choose ${needed.name} or higher to use this.`, requiredPlan: needed.id };
  return { allowed: false, reason: "upgrade", message: `Available on ${needed.name} and higher.`, requiredPlan: needed.id };
}

/**
 * Meters a monthly-limited action. `subjectKey` makes repeat access to the same record in
 * the same month free (opening a docket twice counts once).
 */
export async function meter(
  viewer: Viewer,
  opts: { feature: FeatureKey; kind: UsageKind; limitKey: keyof PlanLimits; subjectKey?: string; label: string },
): Promise<Gate> {
  const f = requireFeature(viewer, opts.feature);
  if (!f.allowed) return f;
  const userId = viewer.userId!;
  const limit = getPlan(viewer.plan).limits[opts.limitKey];
  const since = monthStartIso();
  if (opts.subjectKey && (await hasUsageForSubject(userId, opts.kind, opts.subjectKey, since))) return { allowed: true, limit };
  const used = await countUsage(userId, opts.kind, since, Boolean(opts.subjectKey));
  if (used >= limit) {
    return {
      allowed: false,
      reason: "limit",
      message: `You've used all ${limit} ${opts.label} included this month on ${getPlan(viewer.plan).name}.`,
      used,
      limit,
    };
  }
  recordUsage({ kind: opts.kind, userId, subjectKey: opts.subjectKey ?? null });
  return { allowed: true, used: used + 1, limit };
}

export function meterRecordView(viewer: Viewer, recordKey: string) {
  return meter(viewer, { feature: "docketDetails", kind: "record_view", limitKey: "detailedViewsPerMonth", subjectKey: recordKey, label: "detailed record views" });
}

export function meterAiBrief(viewer: Viewer, recordKey: string) {
  return meter(viewer, { feature: "aiCaseBrief", kind: "ai_brief", limitKey: "aiBriefsPerMonth", subjectKey: recordKey, label: "AI Case Briefs" });
}

export function meterExport(viewer: Viewer) {
  return meter(viewer, { feature: "exports", kind: "export", limitKey: "exportsPerMonth", label: "exports" });
}

export function checkCount(viewer: Viewer, current: number, limitKey: keyof PlanLimits, label: string): Gate {
  const limit = getPlan(viewer.plan).limits[limitKey];
  if (!viewer.userId) return { allowed: false, reason: "sign_in", message: `Create an account to use ${label}.` };
  if (limit <= 0) {
    return { allowed: false, reason: "upgrade", message: `${label[0].toUpperCase()}${label.slice(1)} aren't included on ${getPlan(viewer.plan).name}.`, requiredPlan: "search" };
  }
  if (current >= limit) return { allowed: false, reason: "limit", message: `Your plan includes ${limit} ${label}. Remove one or upgrade.`, used: current, limit };
  return { allowed: true, used: current, limit };
}
