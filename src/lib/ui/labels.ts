import type { CaseCategory, JurisdictionLevel, MatchType, RecordKind, SourceStatus } from "@/lib/domain/types";

export const MATCH_META: Record<MatchType, { label: string; tone: "accent" | "cyan" | "amber" | "emerald" | "rose"; description: string }> = {
  party: { label: "Party", tone: "accent", description: "Formally listed as a party (plaintiff, defendant, petitioner, debtor, etc.) or named in the caption." },
  docket: { label: "Docket match", tone: "cyan", description: "Appears in an underlying docket record — even where no opinion exists." },
  mention: { label: "Mention", tone: "amber", description: "Appears inside an opinion, filing or docket text but is not necessarily a party." },
  attorney: { label: "Attorney / Firm", tone: "emerald", description: "Appears as counsel of record or as a law firm." },
  possible_identity: { label: "Possible identity", tone: "rose", description: "Related to the searched name, but the record lacks enough evidence to establish identity." },
};

export const KIND_LABEL: Record<RecordKind, string> = { docket: "Docket record", opinion: "Opinion", filing: "Filing" };

export const CATEGORY_LABEL: Record<CaseCategory, string> = {
  civil: "Civil",
  criminal: "Criminal",
  bankruptcy: "Bankruptcy",
  appeal: "Appeal",
  other: "Other",
  unknown: "Unknown",
};

export const LEVEL_LABEL: Record<JurisdictionLevel, string> = {
  federal: "Federal",
  state: "State",
  territorial: "Territorial",
  tribal: "Tribal",
  military: "Military",
  other: "Other",
};

export const STATUS_META: Record<SourceStatus, { label: string; tone: "emerald" | "amber" | "rose" | "neutral" }> = {
  searched: { label: "Searched", tone: "emerald" },
  partial: { label: "Partial", tone: "amber" },
  failed: { label: "Failed", tone: "rose" },
  timeout: { label: "Timed out", tone: "rose" },
  quota_exhausted: { label: "Quota reached", tone: "amber" },
  skipped: { label: "Not searched", tone: "neutral" },
  not_configured: { label: "Not configured", tone: "neutral" },
  disabled: { label: "Disabled", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "rose" },
};
