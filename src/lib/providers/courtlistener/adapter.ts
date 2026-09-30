import "server-only";
import { z } from "zod";
import { findCourts, getCourt } from "@/lib/courts";
import { getEnv } from "@/lib/config/env";
import type { AttorneyRef, CaseRecord, DocketDetail, DocumentHit, PartyRef, ProviderId, SearchFilters } from "@/lib/domain/types";
import { captionParties, docketIdFromUrl, mapDocketDetail, mapDocketEntry, mapDocketSearchResult, mapOpinionSearchResult, mapParties, mapRecapDocumentHit, type MapContext } from "./mappers";
import {
  AttorneyPage,
  Cluster,
  Docket,
  DocketAlertCreated,
  DocketEntryPage,
  DocketSearchPage,
  DocumentSearchPage,
  Opinion,
  OpinionSearchPage,
  PartyPage,
  RecapDocument,
  SearchAlertCreated,
  type TAttorney,
} from "./schemas";
import { buildDocketIdLookup, buildDocketSearch, buildDocumentSearch, buildOpinionSearch, cursorFromNext, type CourtRestriction } from "./query";
import type { ClFetcher } from "./client";
import type {
  CaseDetail,
  CourtDataProvider,
  DocketEntriesPage,
  DocumentText,
  EntityQuery,
  EntitySearchResult,
  MonitorHandle,
  MonitorSpec,
  ProviderCapabilities,
  ProviderContext,
  ProviderCoverage,
  ProviderHealth,
  ProviderRecordHit,
  ProviderResult,
  SourceResult,
} from "@/lib/providers/types";
import { notConfigured } from "@/lib/providers/types";
import { collapseWhitespace, titleCase } from "@/lib/text/names";

const APPROX_THRESHOLD = 2000;

const RECAP_CODES = ["F", "FD", "FB", "FBP", "FS"];
const STATE_OPINION_CODES = ["S", "SA", "SS"];
const MAX_COURT_PARAM = 300;

function countOf(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * Resolves user filters into a CourtListener court restriction per corpus.
 * RECAP (dockets, filings) is federal-only, so a "state" restriction yields nothing.
 */
export function resolveRestriction(corpus: "recap" | "opinions", f: SearchFilters): CourtRestriction & { note: string | null } {
  if (f.courts && f.courts.length) {
    if (corpus === "recap") {
      const fed = f.courts.filter((c) => RECAP_CODES.includes(getCourt(c).jurisdictionCode ?? ""));
      return { courts: fed, note: fed.length ? null : "Selected courts are not federal; RECAP holds federal records only." };
    }
    return { courts: f.courts.slice(0, MAX_COURT_PARAM), note: null };
  }
  if (corpus === "recap") {
    if (f.jurisdiction === "state") return { courts: [], note: "RECAP contains federal records only." };
    if (f.states && f.states.length) {
      const ids = findCourts({ states: f.states, codes: RECAP_CODES }).map((c) => c.id);
      return { courts: ids, note: null };
    }
    return { courts: null, note: null };
  }
  // opinions
  if (f.states && f.states.length) {
    const codes = f.jurisdiction === "federal" ? RECAP_CODES : f.jurisdiction === "state" ? [...STATE_OPINION_CODES, "ST", "SAG"] : undefined;
    let ids = findCourts({ states: f.states, codes }).map((c) => c.id);
    let note: string | null = null;
    if (ids.length > MAX_COURT_PARAM) {
      ids = findCourts({ states: f.states, codes: codes?.filter((c) => c !== "ST") ?? [...RECAP_CODES, ...STATE_OPINION_CODES] }).map((c) => c.id);
      note = "State trial-court decisions were excluded to keep the court filter within provider limits.";
    }
    return { courts: ids.slice(0, MAX_COURT_PARAM), note };
  }
  if (f.jurisdiction === "federal") return { courts: findCourts({ codes: RECAP_CODES }).map((c) => c.id).slice(0, MAX_COURT_PARAM), note: null };
  if (f.jurisdiction === "state") {
    return {
      courts: findCourts({ codes: STATE_OPINION_CODES }).map((c) => c.id).slice(0, MAX_COURT_PARAM),
      note: "State filter without a specific state searches state supreme, appellate and special courts; choose a state to include its trial-court decisions.",
    };
  }
  return { courts: null, note: null };
}

/** Whitespace cleanup that keeps paragraph breaks (opinion text is read, not just matched). */
function normalizeParagraphs(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class CourtListenerProvider implements CourtDataProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities = {
    searchEntities: true,
    searchDockets: true,
    searchOpinions: true,
    searchDocuments: true,
    getDocket: true,
    getCase: true,
    getParties: true,
    getAttorneys: true,
    getDocument: true,
    createMonitor: true,
    paid: false,
  };

  constructor(
    private readonly mode: "live" | "demo",
    private readonly fetcher: ClFetcher,
    private readonly retrievedAtOverride?: string,
  ) {
    this.id = mode === "live" ? "courtlistener" : "demo";
    this.label = mode === "live" ? "CourtListener" : "Demo snapshot (CourtListener records, captured 2026-09-30)";
  }

  private mapCtx(): MapContext {
    return {
      provider: this.id,
      live: this.mode === "live",
      retrievedAt: this.retrievedAtOverride ?? new Date().toISOString(),
      getCourt,
    };
  }

  health(): ProviderHealth {
    if (this.mode === "demo") return { provider: this.id, configured: true, enabled: true, live: false, reason: "Demo mode: serving a labeled fixture snapshot." };
    const configured = Boolean(getEnv().COURTLISTENER_API_TOKEN);
    return { provider: this.id, configured, enabled: configured, live: configured, reason: configured ? null : "COURTLISTENER_API_TOKEN is not set." };
  }

  getCoverage(): ProviderCoverage {
    return {
      provider: this.id,
      label: this.label,
      recordTypes: ["Federal dockets (RECAP)", "Federal filings (RECAP)", "Case law opinions"],
      jurisdictions:
        "Federal district, bankruptcy and appellate dockets (RECAP); published and unpublished opinions from federal and state appellate courts plus some state trial courts.",
      dateCoverage: "Case law back to the 1600s; RECAP dockets depend on what has been retrieved from PACER.",
      notes: [
        "RECAP includes basic metadata for new federal district and bankruptcy cases shortly after filing; full party lists and documents exist only for dockets retrieved from PACER.",
        "State trial-court dockets are not available through this provider.",
      ],
    };
  }

  /* ----------------------------------------------------------- searches */

  async searchEntities(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<EntitySearchResult>> {
    const started = Date.now();
    const kinds = q.filters.recordKinds;
    const wantDockets = !kinds || kinds.includes("docket");
    const wantOpinions = !kinds || kinds.includes("opinion");
    const wantFilings = (!kinds || kinds.includes("filing")) && (!q.filters.matchTypes || q.filters.matchTypes.includes("mention") || q.filters.matchTypes.includes("party"));

    const skipped = (source: SourceResult["source"], label: string, message: string): SourceResult => ({
      source, label, status: "skipped", message, hits: [], totalCount: null, countIsApproximate: false, nextCursor: null, requests: 0, cached: false, ms: 0,
    });

    const [dockets, opinions, filings] = await Promise.all([
      wantDockets ? this.searchDockets(q, ctx) : Promise.resolve(null),
      wantOpinions ? this.searchOpinions(q, ctx) : Promise.resolve(null),
      wantFilings ? this.searchDocuments(q, ctx) : Promise.resolve(null),
    ]);

    const toSource = (r: ProviderResult<SourceResult> | null, source: SourceResult["source"], label: string): SourceResult => {
      if (!r) return skipped(source, label, "Excluded by record-type filter.");
      if (r.ok) return r.data;
      const status = r.error.code === "timeout" ? "timeout" : r.error.code === "quota" ? "quota_exhausted" : r.error.code === "not_configured" ? "not_configured" : r.error.code === "not_supported" ? "skipped" : "failed";
      return { source, label, status, message: r.error.message, hits: [], totalCount: null, countIsApproximate: false, nextCursor: null, requests: r.meta.requests, cached: false, ms: r.meta.ms };
    };

    const sources = [
      toSource(dockets, "dockets", "Federal dockets (RECAP)"),
      toSource(opinions, "opinions", "Case law opinions"),
      toSource(filings, "filings", "Federal filings (RECAP full text)"),
    ];
    return { ok: true, data: { provider: this.id, sources }, meta: { requests: sources.reduce((s, x) => s + x.requests, 0), cached: sources.every((s) => s.cached), ms: Date.now() - started } };
  }

  async searchDockets(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<SourceResult>> {
    const restriction = resolveRestriction("recap", q.filters);
    const params = buildDocketSearch(q, restriction);
    const label = "Federal dockets (RECAP)";
    if (!params) {
      return { ok: true, data: { source: "dockets", label, status: "skipped", message: restriction.note ?? "Not applicable to this query type.", hits: [], totalCount: 0, countIsApproximate: false, nextCursor: null, requests: 0, cached: false, ms: 0 }, meta: { requests: 0, cached: false, ms: 0 } };
    }
    const cursor = q.cursors?.dockets;
    if (cursor) params.set("cursor", cursor);
    const res = await this.fetcher({ path: "search/", params, schema: DocketSearchPage, bucket: "docketSearch", ctx });
    if (!res.ok) return res;
    const phrases = q.variants.map((v) => v.text);
    const hits = res.data.results.map((r) => mapDocketSearchResult(r, this.mapCtx(), phrases));
    const total = countOf(res.data.count);
    return {
      ok: true,
      data: { source: "dockets", label, status: "searched", message: restriction.note, hits, totalCount: total, countIsApproximate: (total ?? 0) > APPROX_THRESHOLD, nextCursor: cursorFromNext(res.data.next), requests: res.meta.requests, cached: res.meta.cached, ms: res.meta.ms },
      meta: res.meta,
    };
  }

  async searchOpinions(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<SourceResult>> {
    const restriction = resolveRestriction("opinions", q.filters);
    const params = buildOpinionSearch(q, restriction);
    const label = "Case law opinions";
    if (!params) {
      return { ok: true, data: { source: "opinions", label, status: "skipped", message: restriction.note ?? "Not applicable to this query type.", hits: [], totalCount: 0, countIsApproximate: false, nextCursor: null, requests: 0, cached: false, ms: 0 }, meta: { requests: 0, cached: false, ms: 0 } };
    }
    const cursor = q.cursors?.opinions;
    if (cursor) params.set("cursor", cursor);
    const res = await this.fetcher({ path: "search/", params, schema: OpinionSearchPage, bucket: "opinionSearch", ctx });
    if (!res.ok) return res;
    const phrases = q.variants.map((v) => v.text);
    const hits = res.data.results.map((r) => mapOpinionSearchResult(r, this.mapCtx(), phrases));
    return {
      ok: true,
      data: { source: "opinions", label, status: "searched", message: restriction.note, hits, totalCount: countOf(res.data.count), countIsApproximate: false, nextCursor: cursorFromNext(res.data.next), requests: res.meta.requests, cached: res.meta.cached, ms: res.meta.ms },
      meta: res.meta,
    };
  }

  async searchDocuments(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<SourceResult>> {
    const restriction = resolveRestriction("recap", q.filters);
    const params = buildDocumentSearch(q, restriction);
    const label = "Federal filings (RECAP full text)";
    if (!params) {
      return { ok: true, data: { source: "filings", label, status: "skipped", message: restriction.note ?? "Full-text filing search runs for names only.", hits: [], totalCount: 0, countIsApproximate: false, nextCursor: null, requests: 0, cached: false, ms: 0 }, meta: { requests: 0, cached: false, ms: 0 } };
    }
    const cursor = q.cursors?.filings;
    if (cursor) params.set("cursor", cursor);
    const res = await this.fetcher({ path: "search/", params, schema: DocumentSearchPage, bucket: "filingSearch", ctx });
    if (!res.ok) return res;
    const phrases = q.variants.map((v) => v.text);
    const docs = res.data.results.map((d) => mapRecapDocumentHit(d, this.mapCtx(), phrases));

    // Filing hits carry no docket metadata; look the dockets up in one request.
    const byDocket = new Map<string, DocumentHit[]>();
    for (const d of docs) {
      const id = d.docketId ?? docketIdFromUrl(d.url);
      if (!id) continue;
      byDocket.set(id, [...(byDocket.get(id) ?? []), { ...d, docketId: id }]);
    }
    let requests = res.meta.requests;
    const lookupParams = buildDocketIdLookup([...byDocket.keys()]);
    const records = new Map<string, ProviderRecordHit>();
    let lookupNote: string | null = null;
    if (lookupParams) {
      const lookup = await this.fetcher({ path: "search/", params: lookupParams, schema: DocketSearchPage, bucket: "docketSearch", ctx });
      requests += lookup.meta.requests;
      if (lookup.ok) for (const r of lookup.data.results) records.set(String(r.docket_id), mapDocketSearchResult(r, this.mapCtx(), phrases));
      else lookupNote = "Case details for some filings could not be loaded; titles are taken from the source URL.";
    }

    const hits: ProviderRecordHit[] = [];
    for (const [docketId, docHits] of byDocket) {
      const base = records.get(docketId);
      if (base) {
        hits.push({ ...base, source: "filings", record: { ...base.record, documents: docHits, kinds: ["docket", "filing"] }, evidence: { ...base.evidence, documents: docHits } });
      } else {
        hits.push(this.minimalFilingHit(docketId, docHits));
      }
    }
    const total = countOf(res.data.count);
    return {
      ok: true,
      data: {
        source: "filings",
        label,
        status: "searched",
        message: [restriction.note, lookupNote].filter(Boolean).join(" ") || null,
        hits,
        totalCount: total,
        countIsApproximate: (total ?? 0) > APPROX_THRESHOLD,
        nextCursor: cursorFromNext(res.data.next),
        requests,
        cached: res.meta.cached,
        ms: res.meta.ms,
      },
      meta: { ...res.meta, requests },
    };
  }

  private minimalFilingHit(docketId: string, docs: DocumentHit[]): ProviderRecordHit {
    const slug = docs[0]?.url?.match(/\/docket\/\d+\/(?:[^/]+\/)*?([a-z0-9-]+)\/?$/)?.[1] ?? null;
    const caseName = slug ? `${titleCase(slug.replace(/-/g, " "))} (title from source URL)` : `Docket ${docketId}`;
    const ctx = this.mapCtx();
    const record: CaseRecord = {
      key: `cl-docket-${docketId}`,
      caseName,
      court: getCourt(null),
      docketNumber: null,
      dateFiled: null,
      dateTerminated: null,
      lastActivity: docs[0]?.date ?? null,
      status: "unknown",
      statusBasis: "Docket metadata not loaded",
      category: "unknown",
      natureOfSuit: null,
      cause: null,
      judge: null,
      parties: [],
      partyListCaptured: false,
      attorneys: [],
      firms: [],
      opinions: [],
      documents: docs,
      sources: [{ provider: ctx.provider, kind: "filing", providerRecordId: docketId, url: `https://www.courtlistener.com/docket/${docketId}/`, label: "CourtListener RECAP filing", live: ctx.live, indexedAt: null, retrievedAt: ctx.retrievedAt }],
      kinds: ["filing"],
      citations: [],
      providerDocketId: docketId,
      bankruptcyChapter: null,
    };
    return { source: "filings", record, evidence: { partyNames: [], attorneyNames: [], firmNames: [], caseName, documents: docs, opinionSnippet: null }, providerScore: null };
  }

  /* ------------------------------------------------------------ details */

  async getDocket(id: string, ctx: ProviderContext): Promise<ProviderResult<DocketDetail>> {
    if (!/^\d+$/.test(id)) return { ok: false, error: { code: "bad_request", message: "Invalid docket id." }, meta: { requests: 0, cached: false, ms: 0 } };
    const started = Date.now();
    const fields = "id,court_id,absolute_url,case_name,case_name_short,case_name_full,docket_number,docket_number_core,pacer_case_id,date_filed,date_terminated,date_last_filing,date_modified,date_created,assigned_to_str,referred_to_str,cause,nature_of_suit,jury_demand,jurisdiction_type,appeal_from_str,mdl_status,blocked,clusters";
    const [docket, parties, attorneys, entries] = await Promise.all([
      this.fetcher({ path: `dockets/${id}/`, params: new URLSearchParams({ fields }), schema: Docket, bucket: "docketDetail", ctx }),
      this.getParties(id, ctx),
      this.getAttorneys(id, ctx),
      this.getDocketEntries(id, null, ctx),
    ]);
    if (!docket.ok) return docket;
    const base = mapDocketDetail(docket.data, this.mapCtx());
    const record = { ...base.record };
    let partiesDetailed = false;
    if (parties.ok && parties.data.length) {
      record.parties = parties.data;
      record.partyListCaptured = true;
      partiesDetailed = true;
    } else {
      record.parties = captionParties(record.caseName);
    }
    if (attorneys.ok) record.attorneys = attorneys.data;
    if (docket.data.blocked) record.statusBasis += " · Docket is blocked from search engines at the source";
    const requests = docket.meta.requests + parties.meta.requests + attorneys.meta.requests + entries.meta.requests;
    return {
      ok: true,
      data: {
        record,
        entries: entries.ok ? entries.data.entries : [],
        entriesNextCursor: entries.ok ? entries.data.nextCursor : null,
        entriesTotalKnown: null,
        partiesDetailed,
        dateLastFiling: base.dateLastFiling,
        dateModified: base.dateModified,
      },
      meta: { requests, cached: docket.meta.cached, ms: Date.now() - started },
    };
  }

  async getDocketEntries(id: string, cursor: string | null, ctx: ProviderContext): Promise<ProviderResult<DocketEntriesPage>> {
    const params = new URLSearchParams({ docket: id, order_by: "-date_filed", omit: "recap_documents__plain_text" });
    if (cursor) params.set("cursor", cursor);
    const res = await this.fetcher({ path: "docket-entries/", params, schema: DocketEntryPage, bucket: "docketEntries", ctx });
    if (!res.ok) return res;
    const ctxMap = this.mapCtx();
    return { ok: true, data: { entries: res.data.results.map((e) => mapDocketEntry(e, ctxMap, id)), nextCursor: cursorFromNext(res.data.next) }, meta: res.meta };
  }

  async getParties(docketId: string, ctx: ProviderContext): Promise<ProviderResult<PartyRef[]>> {
    const [parties, attorneys] = await Promise.all([
      this.fetcher({ path: "parties/", params: new URLSearchParams({ docket: docketId, filter_nested_results: "True", fields: "id,name,extra_info,party_types,attorneys" }), schema: PartyPage, bucket: "parties", ctx }),
      this.fetchAttorneys(docketId, ctx),
    ]);
    if (!parties.ok) return parties;
    const byId = new Map<number, TAttorney>();
    if (attorneys.ok) for (const a of attorneys.data.results) byId.set(a.id, a);
    const mapped = mapParties(parties.data.results, byId, docketId);
    return { ok: true, data: mapped.parties, meta: { requests: parties.meta.requests + attorneys.meta.requests, cached: parties.meta.cached, ms: parties.meta.ms } };
  }

  private fetchAttorneys(docketId: string, ctx: ProviderContext) {
    return this.fetcher({ path: "attorneys/", params: new URLSearchParams({ docket: docketId, fields: "id,name" }), schema: AttorneyPage, bucket: "parties", ctx });
  }

  async getAttorneys(docketId: string, ctx: ProviderContext): Promise<ProviderResult<AttorneyRef[]>> {
    const [parties, attorneys] = await Promise.all([
      this.fetcher({ path: "parties/", params: new URLSearchParams({ docket: docketId, filter_nested_results: "True", fields: "id,name,extra_info,party_types,attorneys" }), schema: PartyPage, bucket: "parties", ctx }),
      this.fetchAttorneys(docketId, ctx),
    ]);
    if (!attorneys.ok) return attorneys;
    const byId = new Map<number, TAttorney>();
    for (const a of attorneys.data.results) byId.set(a.id, a);
    const mapped = parties.ok ? mapParties(parties.data.results, byId, docketId).attorneys : [];
    // Attorneys listed on the docket but not linked to a party in the first page of parties.
    for (const a of attorneys.data.results) {
      if (!mapped.some((m) => m.providerAttorneyId === String(a.id))) {
        mapped.push({ name: collapseWhitespace(a.name ?? `Attorney record ${a.id}`), providerAttorneyId: String(a.id), roles: [], representing: [] });
      }
    }
    return { ok: true, data: mapped, meta: attorneys.meta };
  }

  async getCase(id: string, ctx: ProviderContext): Promise<ProviderResult<CaseDetail>> {
    if (!/^\d+$/.test(id)) return { ok: false, error: { code: "bad_request", message: "Invalid cluster id." }, meta: { requests: 0, cached: false, ms: 0 } };
    const cluster = await this.fetcher({
      path: `clusters/${id}/`,
      params: new URLSearchParams({ fields: "id,absolute_url,case_name,case_name_full,date_filed,judges,docket_id,precedential_status,syllabus,procedural_history,posture,sub_opinions,citations" }),
      schema: Cluster,
      bucket: "opinionDetail",
      ctx,
    });
    if (!cluster.ok) return cluster;
    const ops = await this.fetcher({
      path: "opinions/",
      params: new URLSearchParams({ cluster: id, fields: "id,type,plain_text,html_with_citations,download_url,local_path,author_str" }),
      schema: z.object({ results: z.array(Opinion) }).passthrough(),
      bucket: "opinionDetail",
      ctx,
    });
    const c = cluster.data;
    const ctxMap = this.mapCtx();
    const docketRes = c.docket_id ? await this.fetcher({ path: `dockets/${c.docket_id}/`, params: new URLSearchParams({ fields: "id,court_id,docket_number,case_name,absolute_url,date_filed,date_terminated,date_modified" }), schema: Docket, bucket: "docketDetail", ctx }) : null;
    const courtId = docketRes && docketRes.ok ? docketRes.data.court_id : null;
    const court = getCourt(courtId);
    const caseName = collapseWhitespace(c.case_name || c.case_name_full || "") || "Untitled decision";
    const cites = (c.citations ?? []).map((x) => [x.volume, x.reporter, x.page].filter(Boolean).join(" "));
    const url = c.absolute_url ? `https://www.courtlistener.com${c.absolute_url}` : null;
    const first = ops.ok ? ops.data.results[0] : undefined;
    const text = first ? normalizeParagraphs(first.plain_text || (first.html_with_citations ?? "").replace(/<\/p>|<br\s*\/?>/gi, "\n\n").replace(/<[^>]+>/g, " ")) : "";
    const dk = docketRes && docketRes.ok ? docketRes.data : null;
    const record: CaseRecord = {
      key: `cl-cluster-${c.id}`,
      caseName,
      court,
      docketNumber: dk?.docket_number ?? null,
      dateFiled: dk?.date_filed ?? null,
      dateTerminated: dk?.date_terminated ?? null,
      lastActivity: c.date_filed ?? null,
      status: dk?.date_terminated ? "closed" : "unknown",
      statusBasis: dk?.date_terminated ? "Termination date on the court's docket for this decision" : "Opinion records do not report case status",
      category: court.type === "appellate" || court.type === "supreme" ? "appeal" : "unknown",
      natureOfSuit: null,
      cause: null,
      judge: c.judges || null,
      parties: captionParties(caseName),
      partyListCaptured: false,
      attorneys: [],
      firms: [],
      opinions: [{ id: first ? String(first.id) : String(c.id), clusterId: String(c.id), caseName, dateFiled: c.date_filed ?? null, url, downloadUrl: first?.download_url ?? null, citations: cites, status: c.precedential_status ?? null, type: first?.type ?? null, judge: c.judges || null }],
      documents: [],
      sources: [{ provider: ctxMap.provider, kind: "opinion", providerRecordId: String(c.id), url, label: "CourtListener case law", live: ctxMap.live, indexedAt: null, retrievedAt: ctxMap.retrievedAt }],
      kinds: ["opinion"],
      citations: cites,
      providerDocketId: c.docket_id != null ? String(c.docket_id) : null,
      bankruptcyChapter: null,
    };
    const opinionText: DocumentText | null = text
      ? { id: String(first!.id), title: `${caseName} (${first!.type ?? "opinion"})`, text: text.slice(0, 60_000), truncated: text.length > 60_000, url }
      : null;
    return { ok: true, data: { record, opinionText }, meta: { requests: cluster.meta.requests + ops.meta.requests + (docketRes?.meta.requests ?? 0), cached: cluster.meta.cached, ms: cluster.meta.ms } };
  }

  async getDocument(id: string, ctx: ProviderContext): Promise<ProviderResult<DocumentText>> {
    const rid = id.replace(/^cl-rd-/, "");
    if (!/^\d+$/.test(rid)) return { ok: false, error: { code: "bad_request", message: "Invalid document id." }, meta: { requests: 0, cached: false, ms: 0 } };
    const res = await this.fetcher({
      path: `recap-documents/${rid}/`,
      params: new URLSearchParams({ fields: "id,absolute_url,attachment_number,description,document_number,document_type,filepath_local,is_available,is_sealed,page_count,pacer_doc_id,plain_text,date_upload" }),
      schema: RecapDocument,
      bucket: "document",
      ctx,
    });
    if (!res.ok) return res;
    const text = collapseWhitespace(res.data.plain_text ?? "");
    return {
      ok: true,
      data: {
        id: `cl-rd-${res.data.id}`,
        title: collapseWhitespace(res.data.description || `Document ${res.data.document_number ?? ""}`),
        text: text.slice(0, 60_000),
        truncated: text.length > 60_000,
        url: res.data.absolute_url ? `https://www.courtlistener.com${res.data.absolute_url}` : null,
      },
      meta: res.meta,
    };
  }

  async createMonitor(spec: MonitorSpec, ctx: ProviderContext): Promise<ProviderResult<MonitorHandle>> {
    if (this.mode === "demo") return notConfigured(this.id, "demo mode cannot create provider monitors");
    if (!getEnv().COURTLISTENER_WEBHOOKS_ENABLED) return notConfigured(this.id, "COURTLISTENER_WEBHOOKS_ENABLED is off; Case Radar uses polling.");
    if (spec.kind === "docket") {
      const res = await this.fetcher({ path: "docket-alerts/", method: "POST", body: new URLSearchParams({ docket: spec.target }), schema: DocketAlertCreated, bucket: "docketDetail", ctx, noCache: true });
      if (!res.ok) return res;
      return { ok: true, data: { provider: this.id, providerMonitorId: `docket-alert:${res.data.id}`, estimatedHitsPerDay: null }, meta: res.meta };
    }
    const res = await this.fetcher({
      path: "alerts/",
      method: "POST",
      body: new URLSearchParams({ name: spec.name.slice(0, 70), query: spec.target, rate: "rt", alert_type: "d" }),
      schema: SearchAlertCreated,
      bucket: "docketSearch",
      ctx,
      noCache: true,
    });
    if (!res.ok) return res;
    return { ok: true, data: { provider: this.id, providerMonitorId: `search-alert:${res.data.id}`, estimatedHitsPerDay: res.data.estimated_hits != null ? res.data.estimated_hits / 100 : null }, meta: res.meta };
  }
}
