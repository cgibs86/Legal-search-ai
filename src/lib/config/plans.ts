/**
 * Single source of truth for plans, prices, limits and feature entitlements.
 * Change pricing or limits here only. Stripe price IDs are mapped from env on the server
 * (see lib/billing/stripe.ts) so this file is safe to import in client components.
 */

export type PlanId = "free" | "search" | "research_pro" | "intelligence";

export type FeatureKey =
  | "fullResults"
  | "docketDetails"
  | "basicFilters"
  | "advancedFilters"
  | "aiCaseBrief"
  | "mentionIntelligence"
  | "identityResolution"
  | "litigationGraph"
  | "entityTimeline"
  | "researchWorkspaces"
  | "exports"
  | "docketDiff"
  | "advancedEntityProfiles"
  | "expandedExports"
  | "priorityRefresh"
  | "collaboration"
  | "advancedRelationshipAnalysis"
  | "advancedMonitoring"
  | "askResults";

export interface PlanLimits {
  /** Detailed record opens per calendar month (docket viewer, full case cards). */
  detailedViewsPerMonth: number;
  savedSearches: number;
  activeAlerts: number;
  searchesPerHour: number;
  aiBriefsPerMonth: number;
  exportsPerMonth: number;
  projects: number;
  /** Seats in a shared workspace (collaboration architecture). */
  seats: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  priceMonthlyUsd: number;
  recommended?: boolean;
  limits: PlanLimits;
  features: Record<FeatureKey, boolean>;
  highlights: string[];
}

const none: Record<FeatureKey, boolean> = {
  fullResults: false,
  docketDetails: false,
  basicFilters: true,
  advancedFilters: false,
  aiCaseBrief: false,
  mentionIntelligence: false,
  identityResolution: false,
  litigationGraph: false,
  entityTimeline: false,
  researchWorkspaces: false,
  exports: false,
  docketDiff: false,
  advancedEntityProfiles: false,
  expandedExports: false,
  priorityRefresh: false,
  collaboration: false,
  advancedRelationshipAnalysis: false,
  advancedMonitoring: false,
  askResults: false,
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "See what exists before you pay.",
    priceMonthlyUsd: 0,
    limits: {
      detailedViewsPerMonth: 0,
      savedSearches: 0,
      activeAlerts: 0,
      searchesPerHour: 12,
      aiBriefsPerMonth: 0,
      exportsPerMonth: 0,
      projects: 0,
      seats: 1,
    },
    features: { ...none },
    highlights: ["Free searches (rate-limited)", "Match counts and Coverage Ledger", "Jurisdictions and date range"],
  },
  search: {
    id: "search",
    name: "Search",
    tagline: "Occasional individual research.",
    priceMonthlyUsd: 19,
    limits: {
      detailedViewsPerMonth: 25,
      savedSearches: 5,
      activeAlerts: 3,
      searchesPerHour: 60,
      aiBriefsPerMonth: 0,
      exportsPerMonth: 0,
      projects: 0,
      seats: 1,
    },
    features: { ...none, fullResults: true, docketDetails: true, basicFilters: true },
    highlights: ["Full search results", "Case and docket details", "Basic filters", "25 detailed record views / month", "5 saved searches", "3 active alerts"],
  },
  research_pro: {
    id: "research_pro",
    name: "Research Pro",
    tagline: "Serious research, monitoring and briefs.",
    priceMonthlyUsd: 49,
    recommended: true,
    limits: {
      detailedViewsPerMonth: 400,
      savedSearches: 50,
      activeAlerts: 25,
      searchesPerHour: 150,
      aiBriefsPerMonth: 60,
      exportsPerMonth: 100,
      projects: 25,
      seats: 1,
    },
    features: {
      ...none,
      fullResults: true,
      docketDetails: true,
      basicFilters: true,
      advancedFilters: true,
      aiCaseBrief: true,
      mentionIntelligence: true,
      identityResolution: true,
      litigationGraph: true,
      entityTimeline: true,
      researchWorkspaces: true,
      exports: true,
      docketDiff: true,
      askResults: true,
    },
    highlights: [
      "Everything in Search",
      "400 detailed record views / month",
      "AI Case Brief (60 / month)",
      "Mention Intelligence",
      "Identity Resolution",
      "Litigation Graph and Entity Timeline",
      "Research workspaces and exports",
      "25 active alerts with Docket Diff",
    ],
  },
  intelligence: {
    id: "intelligence",
    name: "Intelligence",
    tagline: "Power users and small professional teams.",
    priceMonthlyUsd: 99,
    limits: {
      detailedViewsPerMonth: 1500,
      savedSearches: 250,
      activeAlerts: 100,
      searchesPerHour: 400,
      aiBriefsPerMonth: 250,
      exportsPerMonth: 1000,
      projects: 250,
      seats: 5,
    },
    features: {
      ...none,
      fullResults: true,
      docketDetails: true,
      basicFilters: true,
      advancedFilters: true,
      aiCaseBrief: true,
      mentionIntelligence: true,
      identityResolution: true,
      litigationGraph: true,
      entityTimeline: true,
      researchWorkspaces: true,
      exports: true,
      docketDiff: true,
      advancedEntityProfiles: true,
      expandedExports: true,
      priorityRefresh: true,
      collaboration: true,
      advancedRelationshipAnalysis: true,
      advancedMonitoring: true,
      askResults: true,
    },
    highlights: [
      "Everything in Research Pro",
      "1,500 detailed record views / month",
      "100 active alerts",
      "Advanced entity profiles and relationship analysis",
      "Expanded exports",
      "Priority data refreshes where supported",
      "Shared workspaces (up to 5 seats)",
    ],
  },
};

export const PAID_PLAN_IDS: PlanId[] = ["search", "research_pro", "intelligence"];

export function getPlan(id: PlanId | string | null | undefined): Plan {
  if (id && id in PLANS) return PLANS[id as PlanId];
  return PLANS.free;
}

export function planHasFeature(id: PlanId, feature: FeatureKey): boolean {
  return getPlan(id).features[feature];
}

/** The cheapest plan that includes a feature, for upgrade prompts. */
export function minimumPlanFor(feature: FeatureKey): Plan {
  const order: PlanId[] = ["search", "research_pro", "intelligence"];
  for (const id of order) if (PLANS[id].features[feature]) return PLANS[id];
  return PLANS.intelligence;
}

export const BILLING = {
  currency: "usd",
  interval: "month" as const,
};
