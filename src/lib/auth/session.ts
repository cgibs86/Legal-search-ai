import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { adminEmails, features, resolveDataMode } from "@/lib/config/env";
import { getPlan, type FeatureKey, type PlanId } from "@/lib/config/plans";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const DEMO_COOKIE = "lsa_demo_plan";
export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000de0";

export interface SubscriptionSummary {
  id: string;
  planId: PlanId;
  status: string;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface Viewer {
  kind: "anonymous" | "user" | "demo";
  userId: string | null;
  email: string | null;
  plan: PlanId;
  subscription: SubscriptionSummary | null;
  isAdmin: boolean;
  /** True when auth is not configured and the visitor chose the labeled demo workspace. */
  demo: boolean;
}

const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);
const PLAN_RANK: Record<PlanId, number> = { free: 0, search: 1, research_pro: 2, intelligence: 3 };

export function pickEntitledSubscription(rows: SubscriptionSummary[]): SubscriptionSummary | null {
  const entitled = rows.filter((r) => ENTITLED_STATUSES.has(r.status));
  entitled.sort((a, b) => PLAN_RANK[b.planId] - PLAN_RANK[a.planId]);
  return entitled[0] ?? null;
}

/** Resolves the current visitor, their plan and entitlements. Memoized per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!features.supabase()) {
    const store = await cookies();
    const demoPlan = store.get(DEMO_COOKIE)?.value as PlanId | undefined;
    if (demoPlan && resolveDataMode() === "demo" && ["free", "search", "research_pro", "intelligence"].includes(demoPlan)) {
      return { kind: "demo", userId: DEMO_USER_ID, email: "demo@workspace.local", plan: demoPlan, subscription: null, isAdmin: true, demo: true };
    }
    return { kind: "anonymous", userId: null, email: null, plan: "free", subscription: null, isAdmin: false, demo: false };
  }

  const supabase = await createSupabaseServer();
  const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  const user = data.user;
  if (!user) return { kind: "anonymous", userId: null, email: null, plan: "free", subscription: null, isAdmin: false, demo: false };

  // Subscriptions are readable by their owner under RLS; fall back to the admin client
  // (scoped to this user id) if the RLS client is unavailable.
  const client = supabase ?? getSupabaseAdmin();
  const { data: subs } = (await client
    ?.from("subscriptions")
    .select("id, plan_id, status, current_period_end, trial_end, cancel_at_period_end")
    .eq("user_id", user.id)) ?? { data: [] };
  const rows: SubscriptionSummary[] = (subs ?? []).map((s) => ({
    id: s.id,
    planId: s.plan_id as PlanId,
    status: s.status,
    currentPeriodEnd: s.current_period_end,
    trialEnd: s.trial_end,
    cancelAtPeriodEnd: s.cancel_at_period_end,
  }));
  const sub = pickEntitledSubscription(rows);
  const email = user.email?.toLowerCase() ?? null;
  return {
    kind: "user",
    userId: user.id,
    email,
    plan: sub?.planId ?? "free",
    subscription: sub,
    isAdmin: Boolean(email && adminEmails().includes(email)),
    demo: false,
  };
});

export function can(viewer: Viewer, feature: FeatureKey): boolean {
  return getPlan(viewer.plan).features[feature];
}

export function limits(viewer: Viewer) {
  return getPlan(viewer.plan).limits;
}
