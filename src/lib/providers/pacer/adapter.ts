import "server-only";
import { z } from "zod";
import { getEnv, features } from "@/lib/config/env";
import { getCourt } from "@/lib/courts";
import { cacheGet, cacheKey, cacheSet } from "@/lib/cache/store";
import { takeBudget } from "@/lib/usage/providerBudget";
import { recordUsage } from "@/lib/usage/events";
import { log, errorMessage } from "@/lib/log";
import { caseKey, categoryFor, statusFor } from "@/lib/providers/courtlistener/mappers";
import { looksLikeOrganization, parsePersonName } from "@/lib/text/names";
import type { CaseRecord } from "@/lib/domain/types";
import {
  notConfigured,
  notSupported,
  type CourtDataProvider,
  type EntityQuery,
  type EntitySearchResult,
  type ProviderContext,
  type ProviderCoverage,
  type ProviderHealth,
  type ProviderRecordHit,
  type ProviderResult,
  type SourceResult,
} from "@/lib/providers/types";
import { evaluatePacerPolicy, pacerFeePerPageUsd, PCL_PARTY_ROLES, pclCourtToCourtListener } from "./policy";

/**
 * PACER Case Locator (PCL) API adapter — direct, paid federal index search.
 * Kept separate from RECAP/CourtListener data and labeled as such everywhere.
 * Endpoints per the PCL API user guide (pcl.uscourts.gov/pcl-public-api/rest) and the
 * PACER Authentication API (pacer.login.uscourts.gov/services/cso-auth).
 */

const HOSTS = {
  qa: { auth: "https://qa-login.uscourts.gov", pcl: "https://qa-pcl.uscourts.gov" },
  production: { auth: "https://pacer.login.uscourts.gov", pcl: "https://pcl.uscourts.gov" },
};

const Receipt = z.object({ billablePages: z.number().nullish(), searchFee: z.string().nullish() }).passthrough();
const CourtCase = z
  .object({
    courtId: z.string().nullish(),
    caseId: z.number().nullish(),
    caseTitle: z.string().nullish(),
    caseNumberFull: z.string().nullish(),
    caseType: z.string().nullish(),
    dateFiled: z.string().nullish(),
    effectiveDateClosed: z.string().nullish(),
    natureOfSuit: z.string().nullish(),
    jurisdictionType: z.string().nullish(),
    caseLink: z.string().nullish(),
  })
  .passthrough();
const PartyRow = CourtCase.extend({
  lastName: z.string().nullish(),
  firstName: z.string().nullish(),
  middleName: z.string().nullish(),
  generation: z.string().nullish(),
  partyRole: z.string().nullish(),
  courtCase: CourtCase.nullish(),
});
const PclPage = z
  .object({
    receipt: Receipt.nullish(),
    pageInfo: z.object({ totalElements: z.number().nullish(), totalPages: z.number().nullish() }).passthrough().nullish(),
    content: z.array(PartyRow).nullish(),
  })
  .passthrough();

let token: { value: string; at: number } | null = null;

async function authenticate(signal?: AbortSignal): Promise<string> {
  if (token && Date.now() - token.at < 4 * 3600_000) return token.value;
  const env = getEnv();
  const host = HOSTS[env.PACER_ENVIRONMENT];
  const res = await fetch(`${host.auth}/services/cso-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ loginId: env.PACER_USERNAME, password: env.PACER_PASSWORD, ...(env.PACER_CLIENT_CODE ? { clientCode: env.PACER_CLIENT_CODE } : {}) }),
    signal,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { nextGenCSO?: string; loginResult?: string; errorDescription?: string };
  if (!res.ok || json.loginResult !== "0" || !json.nextGenCSO) {
    throw new Error(`PACER authentication failed${json.errorDescription ? `: ${json.errorDescription}` : ""}`);
  }
  token = { value: json.nextGenCSO, at: Date.now() };
  return token.value;
}

export class PacerProvider implements CourtDataProvider {
  readonly id = "pacer_pcl" as const;
  readonly label = "PACER Case Locator (direct, paid)";
  readonly capabilities = {
    searchEntities: true,
    searchDockets: true,
    searchOpinions: false,
    searchDocuments: false,
    getDocket: false,
    getCase: false,
    getParties: false,
    getAttorneys: false,
    getDocument: false,
    createMonitor: false,
    paid: true,
  };

  health(): ProviderHealth {
    const env = getEnv();
    const configured = Boolean(env.PACER_USERNAME && env.PACER_PASSWORD);
    const enabled = features.pacer() && env.PACER_MAX_DAILY_SPEND_USD > 0;
    return {
      provider: this.id,
      configured,
      enabled,
      live: enabled,
      reason: !configured ? "PACER credentials not set." : !env.PACER_ENABLED ? "PACER_ENABLED is off." : env.PACER_MAX_DAILY_SPEND_USD <= 0 ? "Daily PACER spend cap is $0." : null,
    };
  }

  getCoverage(): ProviderCoverage {
    return {
      provider: this.id,
      label: this.label,
      recordTypes: ["Federal case index (case and party search)"],
      jurisdictions: "All federal district, bankruptcy and appellate courts indexed by PCL.",
      dateCoverage: "Per PCL; typically from each court's CM/ECF start date.",
      notes: [`Billed per page of up to 54 results ($${pacerFeePerPageUsd().toFixed(2)}/page today).`, "Index data only: no documents or docket entries."],
    };
  }

  async searchEntities(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<EntitySearchResult>> {
    const r = await this.searchDockets(q, ctx);
    const source: SourceResult = r.ok
      ? r.data
      : { source: "pacer_cases", label: this.label, status: r.error.code === "not_configured" || r.error.code === "policy_blocked" ? "disabled" : "failed", message: r.error.message, hits: [], totalCount: null, countIsApproximate: false, nextCursor: null, requests: r.meta.requests, cached: false, ms: r.meta.ms };
    return { ok: true, data: { provider: this.id, sources: [source] }, meta: r.meta };
  }

  async searchDockets(q: EntityQuery, ctx: ProviderContext): Promise<ProviderResult<SourceResult>> {
    const env = getEnv();
    const started = Date.now();
    const decision = evaluatePacerPolicy({
      enabled: env.PACER_ENABLED,
      configured: Boolean(env.PACER_USERNAME && env.PACER_PASSWORD),
      userRequested: Boolean(ctx.allowPaid),
      plan: ctx.plan,
      allowedPlans: env.PACER_ALLOWED_PLANS.split(",").map((s) => s.trim()),
      maxDailySpendUsd: env.PACER_MAX_DAILY_SPEND_USD,
      requestedPages: 1,
      maxPagesPerSearch: env.PACER_MAX_PAGES_PER_SEARCH,
    });
    if (!decision.allowed) return { ok: false, error: { code: "policy_blocked", message: decision.reason }, meta: { requests: 0, cached: false, ms: 0 } };

    const { endpoint, body } = this.buildRequest(q);
    if (!endpoint) return notSupported(this.id, `search for ${q.entityType}`);

    const key = cacheKey({ provider: "pacer_pcl", op: endpoint, bucket: "pacerSearch", params: body });
    const cached = await cacheGet<z.infer<typeof PclPage>>(key);
    if (cached) return { ok: true, data: this.toSource(cached, 0, true, Date.now() - started), meta: { requests: 0, cached: true, ms: Date.now() - started } };

    const costCents = Math.round(decision.estimatedCostUsd * 100);
    const budget = await takeBudget("pacer:spend_cents", costCents, Math.round(env.PACER_MAX_DAILY_SPEND_USD * 100));
    if (!budget.allowed) return { ok: false, error: { code: "quota", message: "Daily PACER spend cap reached." }, meta: { requests: 0, cached: false, ms: 0 } };

    try {
      const cso = await authenticate(ctx.signal);
      const host = HOSTS[env.PACER_ENVIRONMENT];
      const res = await fetch(`${host.pcl}/pcl-public-api/rest/${endpoint}?page=0`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-NEXT-GEN-CSO": cso },
        body: JSON.stringify(body),
        signal: ctx.signal,
        cache: "no-store",
      });
      const renewed = res.headers.get("X-NEXT-GEN-CSO");
      if (renewed) token = { value: renewed, at: Date.now() };
      if (res.status === 401) token = null;
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        recordUsage({ kind: "provider_error", provider: "pacer_pcl", status: String(res.status), ms: Date.now() - started });
        return { ok: false, error: { code: res.status === 401 ? "auth" : "upstream", message: `PACER PCL returned HTTP ${res.status}.` }, meta: { requests: 1, cached: false, ms: Date.now() - started } };
      }
      const parsed = PclPage.safeParse(json);
      if (!parsed.success) return { ok: false, error: { code: "upstream", message: "Unexpected PCL response format." }, meta: { requests: 1, cached: false, ms: Date.now() - started } };
      const fee = Number(parsed.data.receipt?.searchFee ?? decision.estimatedCostUsd);
      recordUsage({ kind: "pacer_spend", userId: ctx.userId, provider: "pacer_pcl", quantity: Math.round(fee * 100), props: { billablePages: parsed.data.receipt?.billablePages ?? null } });
      await cacheSet(key, parsed.data, "pacerSearch");
      return { ok: true, data: this.toSource(parsed.data, 1, false, Date.now() - started, fee), meta: { requests: 1, cached: false, ms: Date.now() - started, costUsd: fee } };
    } catch (e) {
      log.warn("pacer.search_failed", { error: errorMessage(e), requestId: ctx.requestId });
      return { ok: false, error: { code: "network", message: errorMessage(e) }, meta: { requests: 1, cached: false, ms: Date.now() - started } };
    }
  }

  private buildRequest(q: EntityQuery): { endpoint: string | null; body: Record<string, unknown> } {
    const dates = { ...(q.filters.filedAfter ? { dateFiledFrom: q.filters.filedAfter } : {}), ...(q.filters.filedBefore ? { dateFiledTo: q.filters.filedBefore } : {}) };
    if (q.entityType === "docket_number" && q.docketNumber) return { endpoint: "cases/find", body: { caseNumberFull: q.docketNumber, ...dates } };
    if (q.entityType === "case" || q.entityType === "company" || q.entityType === "law_firm" || looksLikeOrganization(q.raw)) {
      return { endpoint: "cases/find", body: { caseTitle: q.raw, ...dates } };
    }
    if (q.entityType === "person" || q.entityType === "unknown") {
      const n = parsePersonName(q.raw);
      if (!n.last) return { endpoint: null, body: {} };
      return {
        endpoint: "parties/find",
        body: { lastName: n.last, ...(n.first ? { firstName: n.first } : {}), ...(n.middle[0] ? { middleName: n.middle[0] } : {}), ...dates },
      };
    }
    return { endpoint: null, body: {} };
  }

  private toSource(data: z.infer<typeof PclPage>, requests: number, cached: boolean, ms: number, costUsd?: number): SourceResult {
    const now = new Date().toISOString();
    const hits: ProviderRecordHit[] = (data.content ?? []).map((row) => {
      const cc = row.courtCase ?? row;
      const clCourt = pclCourtToCourtListener(cc.courtId ?? row.courtId ?? "");
      const court = getCourt(clCourt, cc.courtId ?? null);
      const personName = [row.firstName, row.middleName?.trim() || null, row.lastName, row.generation?.trim() || null].filter(Boolean).join(" ");
      const caseName = cc.caseTitle ?? "Untitled case";
      const role = row.partyRole ? PCL_PARTY_ROLES[row.partyRole] ?? row.partyRole : null;
      const { status, basis } = statusFor(cc.effectiveDateClosed, true);
      const record: CaseRecord = {
        key: caseKey(court.id, cc.caseNumberFull, `pcl-${cc.courtId}-${cc.caseId}`),
        caseName,
        court,
        docketNumber: cc.caseNumberFull ?? null,
        dateFiled: cc.dateFiled ?? null,
        dateTerminated: cc.effectiveDateClosed ?? null,
        lastActivity: null,
        status,
        statusBasis: basis,
        category: categoryFor(court, cc.caseNumberFull ?? null, { jurisdictionType: cc.jurisdictionType, suitNature: cc.natureOfSuit }),
        natureOfSuit: cc.natureOfSuit ?? null,
        cause: null,
        judge: null,
        parties: personName ? [{ name: personName, role, roleSource: "party_record", isOrganization: false, providerPartyId: null }] : [],
        partyListCaptured: false,
        attorneys: [],
        firms: [],
        opinions: [],
        documents: [],
        sources: [{ provider: "pacer_pcl", kind: "docket", providerRecordId: `${cc.courtId}-${cc.caseId}`, url: cc.caseLink ?? null, label: "PACER Case Locator (direct)", live: true, indexedAt: null, retrievedAt: now }],
        kinds: ["docket"],
        citations: [],
        providerDocketId: null,
        bankruptcyChapter: null,
      };
      return {
        source: "pacer_parties" as const,
        record,
        evidence: { partyNames: personName ? [personName] : [], attorneyNames: [], firmNames: [], caseName, documents: [], opinionSnippet: null, pacerPartyRole: role },
        providerScore: null,
      };
    });
    return {
      source: "pacer_parties",
      label: this.label,
      status: "searched",
      message: costUsd != null ? `Billed by PACER: $${costUsd.toFixed(2)}` : cached ? "Served from cache (no PACER charge)." : null,
      hits,
      totalCount: data.pageInfo?.totalElements ?? hits.length,
      countIsApproximate: false,
      nextCursor: null,
      requests,
      cached,
      ms,
      costUsd,
    };
  }

  searchOpinions = async () => notSupported<SourceResult>(this.id, "opinion search");
  searchDocuments = async () => notSupported<SourceResult>(this.id, "document search");
  getDocket = async () => notSupported<never>(this.id, "docket retrieval (use RECAP fetch via CourtListener)");
  getDocketEntries = async () => notSupported<never>(this.id, "docket entries");
  getCase = async () => notSupported<never>(this.id, "case law");
  getParties = async () => notSupported<never>(this.id, "party lists");
  getAttorneys = async () => notSupported<never>(this.id, "attorney lists");
  getDocument = async () => notSupported<never>(this.id, "documents");
  createMonitor = async () => notConfigured<never>(this.id, "PCL has no monitoring API");
}
