import "server-only";
import { randomUUID } from "node:crypto";
import { resolveDataMode } from "@/lib/config/env";
import type { EntityType, NameVariant, QueryClassification, SearchHit, SearchRequest, ProviderStatusEntry, CoverageLedger, ResultSummary } from "@/lib/domain/types";
import { getPacerProvider, getPrimaryProvider, getStateTrialProvider } from "@/lib/providers/registry";
import type { EntityQuery, ProviderContext, SourceResult } from "@/lib/providers/types";
import { classifyQuery, validateQuery } from "./classify";
import { buildVariants, coreNameSuggestion } from "./variants";
import { classifyHit, toSearchHit } from "./match";
import { dedupeHits } from "./dedupe";
import { applyFilters, sortHits } from "./filters";
import { summarize } from "./summary";
import { buildCoverageLedger } from "./coverage";
import { decodePageToken, encodePageToken } from "./pageToken";
import { parsePersonName } from "@/lib/text/names";
import { recordUsage } from "@/lib/usage/events";
import { log } from "@/lib/log";

export interface InternalSearchResult {
  searchId: string;
  query: string;
  entityType: EntityType;
  classification: QueryClassification;
  variants: NameVariant[];
  suggestedVariants: NameVariant[];
  hits: SearchHit[];
  summary: ResultSummary;
  coverage: CoverageLedger;
  providerStatuses: ProviderStatusEntry[];
  status: "ok" | "partial" | "error";
  nextPageToken: string | null;
  dataMode: "live" | "demo";
  ambiguity: { ambiguous: boolean; reason: string | null; suggestions: string[] };
  tookMs: number;
  error: string | null;
}

export class InvalidSearchError extends Error {}

function ambiguityFor(entityType: EntityType, raw: string, hits: SearchHit[]): InternalSearchResult["ambiguity"] {
  if (entityType !== "person" && entityType !== "attorney" && entityType !== "unknown") return { ambiguous: false, reason: null, suggestions: [] };
  const n = parsePersonName(raw);
  const suggestions: string[] = [];
  let reason: string | null = null;
  if (entityType === "unknown" && raw.trim().split(/\s+/).length === 1) {
    reason = "A single word can match many unrelated people and companies.";
    suggestions.push("Add a first name or full company name", "Pick Person or Company above");
  } else if (!n.middle.length && hits.length >= 15) {
    reason = `${hits.length}+ records match this name. Common names often belong to several different people.`;
    suggestions.push("Add a middle name or initial", "Filter by state or court", "Add a filing-date range", "Open Identity Resolution to review groupings");
  } else if (new Set(hits.map((h) => h.record.court.state).filter(Boolean)).size >= 4 && hits.length >= 8) {
    reason = "Matches span many states, which can indicate different people with the same name.";
    suggestions.push("Filter by state", "Review Identity Resolution clusters");
  }
  return { ambiguous: Boolean(reason), reason, suggestions };
}

export async function runSearch(req: SearchRequest, ctx: Omit<ProviderContext, "requestId"> & { requestId?: string; includePacer?: boolean }): Promise<InternalSearchResult> {
  const started = Date.now();
  const searchId = randomUUID();
  const pctx: ProviderContext = { ...ctx, requestId: ctx.requestId ?? searchId };
  const valid = validateQuery(req.query);
  if (!valid.valid) throw new InvalidSearchError(valid.reason);
  const query = valid.query;
  const classification = classifyQuery(query);
  let entityType: EntityType = req.entityType ?? classification.primary;
  if (req.mode === "docket" && entityType !== "docket_number" && entityType !== "case") entityType = classification.docketNumber ? "docket_number" : "case";
  if (entityType === "docket_number" && !classification.docketNumber) entityType = "case";

  const variants = buildVariants(query, entityType, req.includeVariants);
  const core = entityType === "company" ? coreNameSuggestion(query) : null;
  const filters = req.mode === "docket" ? { ...req.filters, recordKinds: ["docket" as const] } : req.filters;
  const cursors = decodePageToken(req.pageToken ?? null) ?? undefined;
  const q: EntityQuery = {
    raw: query,
    entityType,
    variants,
    docketNumber: classification.docketNumber?.raw ?? (entityType === "docket_number" ? query : null),
    filters,
    sort: req.sort,
    cursors,
    pageSize: 20,
  };

  const dataMode = resolveDataMode();
  const primary = getPrimaryProvider();
  const pacerProvider = getPacerProvider();
  const [primaryRes, pacerRes] = await Promise.all([
    primary.searchEntities(q, pctx),
    ctx.includePacer ? pacerProvider.searchEntities(q, { ...pctx, allowPaid: true }) : Promise.resolve(null),
  ]);

  const primarySources: SourceResult[] = primaryRes.ok ? primaryRes.data.sources : [];
  // When paging, sources without a cursor have nothing more to return.
  const pagedSources = cursors ? primarySources.map((s) => (cursors[s.source] ? s : { ...s, hits: [], status: "skipped" as const, message: "No further pages." })) : primarySources;
  const pacerSource = pacerRes && pacerRes.ok ? pacerRes.data.sources[0] : null;
  const allSources = [...pagedSources, ...(pacerSource ? [pacerSource] : [])];

  const classifyCtx = { entityType, variants, docketNumber: q.docketNumber };
  const rawHits: SearchHit[] = [];
  for (const s of allSources) {
    s.hits.forEach((h, i) => {
      const match = classifyHit(h, classifyCtx);
      if (match) rawHits.push(toSearchHit(h, match, i));
    });
  }
  const merged = dedupeHits(rawHits);
  const filtered = applyFilters(merged, filters);
  const hits = sortHits(filtered, req.sort);

  const statuses: ProviderStatusEntry[] = allSources.map((s) => ({
    source: s.label,
    provider: s.source.startsWith("pacer") ? "pacer_pcl" : primary.id,
    status: s.status,
    message: s.message,
    requests: s.requests,
    cached: s.cached,
    ms: s.ms,
  }));
  const attempted = allSources.filter((s) => s.status !== "skipped" && s.status !== "disabled" && s.status !== "not_configured");
  const failed = attempted.filter((s) => ["failed", "timeout", "quota_exhausted"].includes(s.status));
  const status: InternalSearchResult["status"] = attempted.length > 0 && failed.length === attempted.length ? "error" : failed.length > 0 ? "partial" : "ok";

  const coverage = buildCoverageLedger({
    dataMode,
    primarySources: pagedSources,
    pacer: { health: pacerProvider.health(), result: pacerSource, requested: Boolean(ctx.includePacer) },
    stateTrial: getStateTrialProvider().health(),
    variants,
    filters,
    entityType,
    dedupedCount: hits.length,
  });

  const nextPageToken = encodePageToken(Object.fromEntries(primarySources.map((s) => [s.source, s.nextCursor])));
  const tookMs = Date.now() - started;
  recordUsage({ kind: "search", userId: ctx.userId, status, ms: tookMs, props: { entityType, hits: hits.length, dataMode, page: cursors ? "next" : "first" } });
  log.info("search.completed", { searchId, entityType, status, hits: hits.length, ms: tookMs, requests: allSources.reduce((n, s) => n + s.requests, 0) });

  return {
    searchId,
    query,
    entityType,
    classification,
    variants,
    suggestedVariants: core ? [core] : [],
    hits,
    summary: summarize(hits, allSources),
    coverage,
    providerStatuses: statuses,
    status,
    nextPageToken,
    dataMode,
    ambiguity: ambiguityFor(entityType, query, hits),
    tookMs,
    error: status === "error" ? failed.map((f) => f.message).filter(Boolean).join(" ") || "All sources failed." : null,
  };
}
