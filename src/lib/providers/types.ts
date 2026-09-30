import type {
  CaseRecord,
  DocketDetail,
  DocumentHit,
  EntityType,
  NameVariant,
  PartyRef,
  AttorneyRef,
  ProviderId,
  SearchFilters,
  SortOrder,
  SourceStatus,
} from "@/lib/domain/types";
import type { PlanId } from "@/lib/config/plans";

export type ProviderErrorCode =
  | "not_configured"
  | "disabled"
  | "not_supported"
  | "timeout"
  | "quota"
  | "auth"
  | "bad_request"
  | "not_found"
  | "upstream"
  | "network"
  | "policy_blocked";

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

export interface ProviderMeta {
  requests: number;
  cached: boolean;
  ms: number;
  /** Paid usage incurred by the call (PACER), in USD. */
  costUsd?: number;
}

export type ProviderResult<T> =
  | { ok: true; data: T; meta: ProviderMeta }
  | { ok: false; error: ProviderError; meta: ProviderMeta };

export interface ProviderContext {
  requestId: string;
  userId: string | null;
  plan: PlanId;
  signal?: AbortSignal;
  /** Whether this call may spend paid provider credits (PACER). Defaults to false. */
  allowPaid?: boolean;
}

export interface EntityQuery {
  raw: string;
  entityType: EntityType;
  variants: NameVariant[];
  docketNumber: string | null;
  filters: SearchFilters;
  sort: SortOrder;
  /** Provider-specific opaque cursors from a previous page. */
  cursors?: Record<string, string | null>;
  pageSize: number;
}

/** A normalized record plus the raw evidence needed to classify how it matched. */
export interface ProviderRecordHit {
  source: "dockets" | "opinions" | "filings" | "pacer_cases" | "pacer_parties";
  record: CaseRecord;
  /** Names exactly as the provider listed them, for match classification. */
  evidence: {
    partyNames: string[];
    attorneyNames: string[];
    firmNames: string[];
    caseName: string;
    /** Document-level hits with provider-highlighted or locally matched context. */
    documents: DocumentHit[];
    /** Opinion full-text snippet (highlighted when the provider supports it). */
    opinionSnippet: DocumentHit | null;
    /** PACER party search returns a role per party row. */
    pacerPartyRole?: string | null;
  };
  providerScore: number | null;
}

export interface SourceResult {
  source: ProviderRecordHit["source"];
  label: string;
  status: SourceStatus;
  message: string | null;
  hits: ProviderRecordHit[];
  totalCount: number | null;
  countIsApproximate: boolean;
  nextCursor: string | null;
  requests: number;
  cached: boolean;
  ms: number;
  costUsd?: number;
}

export interface EntitySearchResult {
  provider: ProviderId;
  sources: SourceResult[];
}

export interface MonitorSpec {
  kind: "search" | "docket";
  name: string;
  /** For search monitors: provider-native query string. For docket monitors: docket id. */
  target: string;
}

export interface MonitorHandle {
  provider: ProviderId;
  providerMonitorId: string;
  estimatedHitsPerDay: number | null;
}

export interface ProviderCoverage {
  provider: ProviderId;
  label: string;
  recordTypes: string[];
  jurisdictions: string;
  dateCoverage: string | null;
  notes: string[];
}

export interface ProviderCapabilities {
  searchEntities: boolean;
  searchDockets: boolean;
  searchOpinions: boolean;
  searchDocuments: boolean;
  getDocket: boolean;
  getCase: boolean;
  getParties: boolean;
  getAttorneys: boolean;
  getDocument: boolean;
  createMonitor: boolean;
  paid: boolean;
}

export interface ProviderHealth {
  provider: ProviderId;
  configured: boolean;
  enabled: boolean;
  live: boolean;
  reason: string | null;
}

export interface DocketEntriesPage {
  entries: DocketDetail["entries"];
  nextCursor: string | null;
}

export interface DocumentText {
  id: string;
  title: string;
  text: string;
  truncated: boolean;
  url: string | null;
}

export interface CaseDetail {
  record: CaseRecord;
  opinionText: DocumentText | null;
}

/**
 * The contract every court-data provider implements. Unsupported operations return
 * `{ ok: false, error: { code: "not_supported" } }` rather than throwing, so callers can
 * render an honest state for each source.
 */
export interface CourtDataProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  health(): ProviderHealth;
  getCoverage(): ProviderCoverage;
  searchEntities(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<EntitySearchResult>>;
  searchDockets(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<SourceResult>>;
  searchOpinions(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<SourceResult>>;
  searchDocuments(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<SourceResult>>;
  getDocket(id: string, ctx: ProviderContext): Promise<ProviderResult<DocketDetail>>;
  getDocketEntries(id: string, cursor: string | null, ctx: ProviderContext): Promise<ProviderResult<DocketEntriesPage>>;
  getCase(id: string, ctx: ProviderContext): Promise<ProviderResult<CaseDetail>>;
  getParties(docketId: string, ctx: ProviderContext): Promise<ProviderResult<PartyRef[]>>;
  getAttorneys(docketId: string, ctx: ProviderContext): Promise<ProviderResult<AttorneyRef[]>>;
  getDocument(id: string, ctx: ProviderContext): Promise<ProviderResult<DocumentText>>;
  createMonitor(spec: MonitorSpec, ctx: ProviderContext): Promise<ProviderResult<MonitorHandle>>;
}

export function notSupported<T>(provider: ProviderId, op: string): ProviderResult<T> {
  return {
    ok: false,
    error: { code: "not_supported", message: `${provider} does not support ${op}.` },
    meta: { requests: 0, cached: false, ms: 0 },
  };
}

export function notConfigured<T>(provider: ProviderId, what: string): ProviderResult<T> {
  return {
    ok: false,
    error: { code: "not_configured", message: `${provider} is not configured: ${what}` },
    meta: { requests: 0, cached: false, ms: 0 },
  };
}

export type { CaseRecord };
