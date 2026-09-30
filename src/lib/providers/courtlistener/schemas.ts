import { z } from "zod";

/**
 * Runtime schemas for CourtListener REST API v4 responses. Only the fields this app uses
 * are declared; unknown fields pass through untouched. Every field is nullable/optional
 * because the API omits or nulls fields inconsistently across record types.
 */

const str = z.string().nullish();
const num = z.number().nullish();
const strArr = z.array(z.string()).nullish();

export const SearchMeta = z
  .object({
    timestamp: str,
    date_created: str,
    score: z.object({ bm25: z.number().nullish() }).passthrough().nullish(),
    more_docs: z.boolean().nullish(),
  })
  .passthrough()
  .nullish();

export const RecapDocumentHit = z
  .object({
    id: z.number(),
    absolute_url: str,
    attachment_number: num,
    description: str,
    short_description: str,
    docket_entry_id: num,
    docket_id: num,
    document_number: z.union([z.number(), z.string()]).nullish(),
    document_type: z.union([z.string(), z.number()]).nullish(),
    entry_date_filed: str,
    entry_number: z.union([z.number(), z.string()]).nullish(),
    filepath_local: str,
    is_available: z.boolean().nullish(),
    page_count: num,
    pacer_doc_id: str,
    snippet: str,
    meta: SearchMeta,
  })
  .passthrough();

export const DocketSearchResult = z
  .object({
    docket_id: z.number(),
    caseName: str,
    case_name_full: str,
    docketNumber: str,
    court: str,
    court_id: str,
    court_citation_string: str,
    dateFiled: str,
    dateTerminated: str,
    dateArgued: str,
    docket_absolute_url: str,
    assignedTo: str,
    referredTo: str,
    cause: str,
    suitNature: str,
    jurisdictionType: str,
    juryDemand: str,
    chapter: z.union([z.string(), z.number()]).nullish(),
    trustee_str: str,
    pacer_case_id: str,
    party: strArr,
    attorney: strArr,
    firm: strArr,
    recap_documents: z.array(RecapDocumentHit).nullish(),
    meta: SearchMeta,
  })
  .passthrough();

export const OpinionSnippet = z
  .object({
    id: z.number(),
    author_id: num,
    download_url: str,
    local_path: str,
    per_curiam: z.boolean().nullish(),
    snippet: str,
    type: str,
  })
  .passthrough();

export const OpinionSearchResult = z
  .object({
    cluster_id: z.number(),
    absolute_url: str,
    caseName: str,
    caseNameFull: str,
    citation: strArr,
    citeCount: num,
    court: str,
    court_id: str,
    court_citation_string: str,
    dateFiled: str,
    dateArgued: str,
    docketNumber: str,
    docket_id: num,
    judge: str,
    status: str,
    suitNature: str,
    attorney: str,
    opinions: z.array(OpinionSnippet).nullish(),
    meta: SearchMeta,
  })
  .passthrough();

export function searchPage<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      count: z.union([z.number(), z.string()]).nullish(),
      next: str,
      previous: str,
      results: z.array(item),
    })
    .passthrough();
}

export const DocketSearchPage = searchPage(DocketSearchResult);
export const OpinionSearchPage = searchPage(OpinionSearchResult);
export const DocumentSearchPage = searchPage(RecapDocumentHit);

export const Docket = z
  .object({
    id: z.number(),
    court_id: str,
    absolute_url: str,
    case_name: str,
    case_name_short: str,
    case_name_full: str,
    docket_number: str,
    docket_number_core: str,
    pacer_case_id: str,
    date_filed: str,
    date_terminated: str,
    date_last_filing: str,
    date_modified: str,
    date_created: str,
    assigned_to_str: str,
    referred_to_str: str,
    cause: str,
    nature_of_suit: str,
    jury_demand: str,
    jurisdiction_type: str,
    appeal_from_str: str,
    mdl_status: str,
    blocked: z.boolean().nullish(),
    clusters: strArr,
  })
  .passthrough();

export const RecapDocument = z
  .object({
    id: z.number(),
    absolute_url: str,
    attachment_number: num,
    description: str,
    document_number: z.union([z.string(), z.number()]).nullish(),
    document_type: z.union([z.number(), z.string()]).nullish(),
    filepath_local: str,
    is_available: z.boolean().nullish(),
    is_sealed: z.boolean().nullish(),
    page_count: num,
    pacer_doc_id: str,
    plain_text: str,
    date_upload: str,
  })
  .passthrough();

export const DocketEntry = z
  .object({
    id: z.number(),
    entry_number: z.union([z.number(), z.string()]).nullish(),
    date_filed: str,
    date_modified: str,
    description: str,
    recap_documents: z.array(RecapDocument).nullish(),
  })
  .passthrough();

export const DocketEntryPage = z
  .object({ next: str, previous: str, results: z.array(DocketEntry) })
  .passthrough();

export const PartyType = z
  .object({ name: str, date_terminated: str, extra_info: str, docket_id: num })
  .passthrough();

export const PartyAttorneyLink = z
  .object({ attorney_id: num, docket_id: num, role: num, date_action: str })
  .passthrough();

export const Party = z
  .object({
    id: z.number(),
    name: str,
    extra_info: str,
    party_types: z.array(PartyType).nullish(),
    attorneys: z.array(PartyAttorneyLink).nullish(),
  })
  .passthrough();

export const PartyPage = z.object({ next: str, previous: str, results: z.array(Party) }).passthrough();

export const Attorney = z
  .object({
    id: z.number(),
    name: str,
    parties_represented: z
      .array(z.object({ role: num, docket: str, party: str, date_action: str }).passthrough())
      .nullish(),
  })
  .passthrough();

export const AttorneyPage = z.object({ next: str, previous: str, results: z.array(Attorney) }).passthrough();

export const Cluster = z
  .object({
    id: z.number(),
    absolute_url: str,
    case_name: str,
    case_name_full: str,
    date_filed: str,
    judges: str,
    docket_id: num,
    precedential_status: str,
    syllabus: str,
    procedural_history: str,
    posture: str,
    sub_opinions: strArr,
    citations: z.array(z.object({ volume: z.union([z.number(), z.string()]).nullish(), reporter: str, page: str }).passthrough()).nullish(),
  })
  .passthrough();

export const Opinion = z
  .object({
    id: z.number(),
    type: str,
    plain_text: str,
    html_with_citations: str,
    download_url: str,
    local_path: str,
    author_str: str,
  })
  .passthrough();

export const SearchAlertCreated = z
  .object({ id: z.number(), estimated_hits: num, secret_key: str })
  .passthrough();

export const DocketAlertCreated = z.object({ id: z.number(), secret_key: str }).passthrough();

export type TDocketSearchResult = z.infer<typeof DocketSearchResult>;
export type TOpinionSearchResult = z.infer<typeof OpinionSearchResult>;
export type TRecapDocumentHit = z.infer<typeof RecapDocumentHit>;
export type TDocket = z.infer<typeof Docket>;
export type TDocketEntry = z.infer<typeof DocketEntry>;
export type TParty = z.infer<typeof Party>;
export type TAttorney = z.infer<typeof Attorney>;
export type TCluster = z.infer<typeof Cluster>;
export type TOpinion = z.infer<typeof Opinion>;

/** Attorney role codes from CourtListener's people_db Role model. */
export const ATTORNEY_ROLES: Record<number, string> = {
  1: "Attorney to be noticed",
  2: "Lead attorney",
  3: "Attorney in sealed group",
  4: "Pro hac vice",
  5: "Self-terminated",
  6: "Terminated",
  7: "Suspended",
  8: "Inactive",
  9: "Disbarred",
  10: "Unknown",
};
