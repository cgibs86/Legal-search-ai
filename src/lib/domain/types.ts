/**
 * Provider-neutral domain model. Every provider adapter maps its native records into
 * these shapes, and every feature (search, identity resolution, graph, alerts) reads
 * only these shapes. Missing information stays `null` — never guessed.
 */

export type ProviderId = "courtlistener" | "pacer_pcl" | "trellis" | "demo";

export type RecordKind = "docket" | "opinion" | "filing";

export type MatchType = "party" | "mention" | "docket" | "attorney" | "possible_identity";

export type EntityType = "person" | "company" | "attorney" | "law_firm" | "case" | "docket_number" | "unknown";

export type JurisdictionLevel = "federal" | "state" | "territorial" | "tribal" | "military" | "other";

export type CourtType = "supreme" | "appellate" | "trial" | "bankruptcy" | "special" | "other";

export type CaseCategory = "civil" | "criminal" | "bankruptcy" | "appeal" | "other" | "unknown";

export type CaseStatus = "active" | "closed" | "unknown";

export interface CourtRef {
  id: string;
  name: string;
  citation: string | null;
  level: JurisdictionLevel;
  type: CourtType;
  state: string | null;
  /** Raw jurisdiction code from the provider (CourtListener: F, FD, FB, S, SA, ST...). */
  jurisdictionCode: string | null;
}

export interface SourceRef {
  provider: ProviderId;
  kind: RecordKind;
  providerRecordId: string;
  url: string | null;
  label: string;
  /** False for demo fixtures. The UI must label non-live data. */
  live: boolean;
  /** When the provider last indexed/updated the record, if reported. */
  indexedAt: string | null;
  /** When this app retrieved it (or the fixture capture date). */
  retrievedAt: string;
}

export type RoleSource = "party_record" | "caption" | "unknown";

export interface PartyRef {
  name: string;
  role: string | null;
  roleSource: RoleSource;
  isOrganization: boolean;
  providerPartyId: string | null;
}

export interface AttorneyRef {
  name: string;
  providerAttorneyId: string | null;
  roles: string[];
  /** Party names this attorney represents in this docket (from the party record only). */
  representing: string[];
}

export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

export interface MentionSnippet {
  segments: SnippetSegment[];
  /** How the highlighted context was produced. We never generate context text. */
  source: "provider_highlight" | "local_match" | "document_excerpt";
  field: "document_text" | "entry_description" | "opinion_text" | "case_name";
}

export interface DocumentHit {
  id: string;
  provider: ProviderId;
  title: string;
  kind: "filing" | "attachment" | "opinion" | "docket_entry";
  date: string | null;
  entryNumber: string | null;
  documentNumber: string | null;
  url: string | null;
  downloadUrl: string | null;
  available: boolean | null;
  pageCount: number | null;
  snippet: MentionSnippet | null;
  docketId: string | null;
}

export interface OpinionRef {
  id: string;
  clusterId: string;
  caseName: string;
  dateFiled: string | null;
  url: string | null;
  downloadUrl: string | null;
  citations: string[];
  status: string | null;
  type: string | null;
  judge: string | null;
}

export interface CaseRecord {
  /** Normalized dedupe key: court + normalized docket number, or a provider fallback. */
  key: string;
  caseName: string;
  court: CourtRef;
  docketNumber: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  lastActivity: string | null;
  status: CaseStatus;
  statusBasis: string;
  category: CaseCategory;
  natureOfSuit: string | null;
  cause: string | null;
  judge: string | null;
  parties: PartyRef[];
  /** True when the party list came from a captured docket party record, not just the caption. */
  partyListCaptured: boolean;
  attorneys: AttorneyRef[];
  firms: string[];
  opinions: OpinionRef[];
  documents: DocumentHit[];
  sources: SourceRef[];
  kinds: RecordKind[];
  citations: string[];
  providerDocketId: string | null;
  bankruptcyChapter: string | null;
}

export type VariantKind =
  | "exact"
  | "middle_initial"
  | "no_middle"
  | "initials"
  | "last_first"
  | "suffix_equivalent"
  | "core_name";

export interface NameVariant {
  text: string;
  kind: VariantKind;
  /** Variants other than exact/suffix_equivalent weaken the match to "possible identity". */
  strength: "exact" | "equivalent" | "weaker";
  explanation: string;
}

export type MatchField =
  | "party"
  | "caption"
  | "attorney"
  | "firm"
  | "document_text"
  | "entry_description"
  | "opinion_text"
  | "docket_number";

export interface MatchInfo {
  types: MatchType[];
  field: MatchField;
  matchedText: string;
  matchedVariant: string;
  variantKind: VariantKind;
  partyRole: string | null;
  reasons: string[];
  /** Always present for person searches: a match never proves identity. */
  identityNote: string | null;
  mentions: DocumentHit[];
}

export interface SearchHit {
  id: string;
  record: CaseRecord;
  match: MatchInfo;
  score: number;
}

export interface QueryClassification {
  primary: EntityType;
  candidates: { type: EntityType; confidence: number; reason: string }[];
  normalized: string;
  docketNumber: { raw: string; normalized: string; courtHint: string | null } | null;
}

export interface SearchFilters {
  matchTypes?: MatchType[];
  recordKinds?: RecordKind[];
  partyKind?: "individual" | "company";
  jurisdiction?: "federal" | "state";
  courts?: string[];
  states?: string[];
  categories?: CaseCategory[];
  status?: CaseStatus;
  filedAfter?: string;
  filedBefore?: string;
  terminatedAfter?: string;
  terminatedBefore?: string;
}

export type SortOrder = "relevance" | "newest" | "oldest";

export type SearchMode = "universal" | "docket";

export interface SearchRequest {
  query: string;
  entityType?: EntityType;
  mode: SearchMode;
  filters: SearchFilters;
  sort: SortOrder;
  includeVariants: boolean;
  pageToken?: string | null;
}

export type SourceStatus =
  | "searched"
  | "partial"
  | "failed"
  | "timeout"
  | "quota_exhausted"
  | "skipped"
  | "not_configured"
  | "disabled"
  | "unavailable";

export interface CoverageSource {
  id: string;
  provider: ProviderId | "none";
  label: string;
  recordTypes: string[];
  jurisdictions: string;
  status: SourceStatus;
  resultCount: number | null;
  countIsApproximate: boolean;
  dateCoverage: string | null;
  freshness: string | null;
  note: string | null;
}

export interface CoverageLedger {
  searchedAt: string;
  dataMode: "live" | "demo";
  sources: CoverageSource[];
  jurisdictionsSearched: { label: string; courts: number; note: string }[];
  jurisdictionsUnavailable: { label: string; reason: string }[];
  recordTypes: { type: string; searched: boolean; note: string }[];
  counts: { exact: boolean; note: string };
  variantsSearched: NameVariant[];
  filtersApplied: string[];
  notes: string[];
}

export interface ResultSummary {
  total: number;
  totalIsApproximate: boolean;
  byMatchType: Record<MatchType, number>;
  byKind: Record<RecordKind, number>;
  jurisdictions: { level: JurisdictionLevel; count: number }[];
  states: { state: string; count: number }[];
  courts: { id: string; name: string; count: number }[];
  dateRange: { from: string | null; to: string | null };
  providerTotals: { source: string; count: number; approximate: boolean }[];
}

export type PaywallVariant = "A" | "B" | "C";

export interface PaywallState {
  variant: PaywallVariant;
  locked: boolean;
  /** Number of hits delivered unmasked. */
  unlockedCount: number;
  reason: "anonymous" | "no_plan" | "none";
}

export interface MaskedHit {
  id: string;
  masked: true;
  /** Coarse, non-identifying hints only (the UI blurs these). */
  court: { level: JurisdictionLevel; state: string | null; type: CourtType };
  year: string | null;
  kinds: RecordKind[];
  matchTypes: MatchType[];
  /** Variant C shows basic metadata; A/B never include it. */
  basic: { caseName: string; courtName: string; docketNumber: string | null; dateFiled: string | null } | null;
}

export type DeliveredHit = SearchHit | MaskedHit;

export function isMasked(hit: DeliveredHit): hit is MaskedHit {
  return (hit as MaskedHit).masked === true;
}

export interface ProviderStatusEntry {
  source: string;
  provider: ProviderId;
  status: SourceStatus;
  message: string | null;
  requests: number;
  cached: boolean;
  ms: number;
}

export interface SearchResponse {
  searchId: string;
  query: string;
  classification: QueryClassification;
  variants: NameVariant[];
  status: "ok" | "partial" | "error";
  hits: DeliveredHit[];
  summary: ResultSummary;
  coverage: CoverageLedger;
  providerStatuses: ProviderStatusEntry[];
  paywall: PaywallState;
  identity: import("./identity").IdentityResolution | { locked: true; clusterCount: number } | null;
  nextPageToken: string | null;
  dataMode: "live" | "demo";
  ambiguity: { ambiguous: boolean; reason: string | null; suggestions: string[] };
  tookMs: number;
}

export interface DocketEntry {
  id: string;
  entryNumber: string | null;
  dateFiled: string | null;
  description: string;
  category: DocketEntryCategory;
  important: boolean;
  deadlines: { date: string; text: string }[];
  documents: DocumentHit[];
}

export type DocketEntryCategory =
  | "complaint"
  | "order"
  | "judgment"
  | "motion"
  | "hearing"
  | "notice"
  | "appeal"
  | "transcript"
  | "stipulation"
  | "brief"
  | "other";

export interface DocketDetail {
  record: CaseRecord;
  entries: DocketEntry[];
  entriesNextCursor: string | null;
  entriesTotalKnown: number | null;
  partiesDetailed: boolean;
  dateLastFiling: string | null;
  dateModified: string | null;
}
