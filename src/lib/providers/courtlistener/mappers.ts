import type {
  AttorneyRef,
  CaseCategory,
  CaseRecord,
  CaseStatus,
  CourtRef,
  DocketDetail,
  DocketEntry,
  DocketEntryCategory,
  DocumentHit,
  MentionSnippet,
  OpinionRef,
  PartyRef,
  ProviderId,
  SnippetSegment,
  SourceRef,
} from "@/lib/domain/types";
import { captionSides, cleanAttorneyName, cleanFirmName, cleanJudgeName, collapseWhitespace, findPhraseRanges, firmKey, isPlaceholderParty, looksLikeOrganization, normalizeName } from "@/lib/text/names";
import type { ProviderRecordHit } from "@/lib/providers/types";
import {
  ATTORNEY_ROLES,
  type TAttorney,
  type TDocket,
  type TDocketEntry,
  type TDocketSearchResult,
  type TOpinionSearchResult,
  type TParty,
  type TRecapDocumentHit,
} from "./schemas";

export const CL_WEB = "https://www.courtlistener.com";
export const CL_STORAGE = "https://storage.courtlistener.com";

export interface MapContext {
  provider: ProviderId;
  live: boolean;
  retrievedAt: string;
  getCourt: (id: string | null | undefined, name?: string | null, cite?: string | null) => CourtRef;
}

/** Deduplicated, cleaned attorney refs from docket-search strings (role tails kept as roles). */
function cleanAttorneys(raw: string[]): AttorneyRef[] {
  const out = new Map<string, AttorneyRef>();
  for (const r of raw) {
    const { name, role } = cleanAttorneyName(r);
    if (!name) continue;
    const key = normalizeName(name);
    const cur = out.get(key) ?? { name, providerAttorneyId: null, roles: [], representing: [] };
    if (role && !cur.roles.includes(role)) cur.roles.push(role);
    out.set(key, cur);
  }
  return [...out.values()];
}

/** Firm names without embedded phone numbers, deduplicated by suffix-insensitive core. */
function cleanFirms(raw: string[]): string[] {
  const out = new Map<string, string>();
  for (const r of raw) {
    const name = cleanFirmName(r);
    const key = firmKey(name);
    if (name && key && !out.has(key)) out.set(key, name);
  }
  return [...out.values()];
}

export function absUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${CL_WEB}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function storageUrl(filepath: string | null | undefined): string | null {
  if (!filepath) return null;
  if (/^https?:\/\//.test(filepath)) return filepath;
  return `${CL_STORAGE}/${filepath.replace(/^\//, "")}`;
}

/* ---------------------------------------------------------------- snippets */

const MAX_SNIPPET = 420;

/** Converts CourtListener `<mark>` highlighting into safe text segments. Other tags are dropped. */
export function parseHighlightedSnippet(snippet: string | null | undefined): SnippetSegment[] | null {
  if (!snippet || !snippet.includes("<mark>")) return null;
  const segments: SnippetSegment[] = [];
  const re = /<mark>([\s\S]*?)<\/mark>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) segments.push({ text: stripTags(snippet.slice(last, m.index)), highlight: false });
    segments.push({ text: stripTags(m[1]), highlight: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) segments.push({ text: stripTags(snippet.slice(last)), highlight: false });
  return trimSegments(segments.map((s) => ({ ...s, text: collapseWhitespace(s.text) })).filter((s) => s.text.length > 0));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function trimSegments(segs: SnippetSegment[]): SnippetSegment[] {
  const total = segs.reduce((n, s) => n + s.text.length, 0);
  if (total <= MAX_SNIPPET) return segs;
  const firstHi = segs.findIndex((s) => s.highlight);
  const out: SnippetSegment[] = [];
  let budget = MAX_SNIPPET;
  for (let i = Math.max(0, firstHi - 1); i < segs.length && budget > 0; i++) {
    let t = segs[i].text;
    if (i === firstHi - 1 && t.length > 140) t = "… " + t.slice(t.length - 140);
    if (t.length > budget) t = t.slice(0, budget) + " …";
    out.push({ text: t, highlight: segs[i].highlight });
    budget -= t.length;
  }
  return out;
}

/** Builds highlight segments locally from source text (used when the provider did not highlight). */
export function localHighlight(text: string, phrases: string[], window = 170): SnippetSegment[] | null {
  const clean = collapseWhitespace(text);
  let ranges: { start: number; end: number }[] = [];
  for (const p of phrases) ranges = ranges.concat(findPhraseRanges(clean, p));
  if (ranges.length === 0) return null;
  ranges.sort((a, b) => a.start - b.start);
  const first = ranges[0];
  const from = Math.max(0, first.start - window);
  const to = Math.min(clean.length, first.end + window);
  const inWindow = ranges.filter((r) => r.start >= from && r.end <= to);
  const segs: SnippetSegment[] = [];
  let cur = from;
  for (const r of inWindow) {
    if (r.start < cur) continue;
    if (r.start > cur) segs.push({ text: clean.slice(cur, r.start), highlight: false });
    segs.push({ text: clean.slice(r.start, r.end), highlight: true });
    cur = r.end;
  }
  if (cur < to) segs.push({ text: clean.slice(cur, to), highlight: false });
  if (from > 0) segs[0] = { ...segs[0], text: "… " + segs[0].text };
  if (to < clean.length) segs[segs.length - 1] = { ...segs[segs.length - 1], text: segs[segs.length - 1].text + " …" };
  return segs;
}

export function buildSnippet(
  raw: string | null | undefined,
  plainFallback: string | null | undefined,
  phrases: string[],
  field: MentionSnippet["field"],
): MentionSnippet | null {
  const provider = parseHighlightedSnippet(raw);
  if (provider) return { segments: provider, source: "provider_highlight", field };
  const text = plainFallback ?? raw;
  if (text) {
    const local = localHighlight(stripTags(text), phrases);
    if (local) return { segments: local, source: "local_match", field };
  }
  return null;
}

export function excerpt(raw: string | null | undefined, field: MentionSnippet["field"], max = 360): MentionSnippet | null {
  if (!raw) return null;
  const t = collapseWhitespace(stripTags(raw));
  if (!t) return null;
  return { segments: [{ text: t.length > max ? t.slice(0, max) + " …" : t, highlight: false }], source: "document_excerpt", field };
}

/* ------------------------------------------------------------ normalization */

/**
 * Normalizes docket numbers so the same matter from different sources dedupes:
 * "4:20-cv-05640", "4:2020cv05640", "20-cv-5640" -> "20-cv-05640". Appellate "21-16506" stays.
 */
export function normalizeDocketNumber(dn: string | null | undefined): string | null {
  if (!dn) return null;
  const s = dn.toLowerCase().replace(/^no\.?\s*/i, "").trim();
  const fed = s.match(/(?:\d+:)?(\d{2}|\d{4})[-\s]?([a-z]{1,4})[-\s]?(\d{1,6})/i);
  if (fed) {
    const yy = fed[1].slice(-2);
    return `${yy}-${fed[2]}-${fed[3].padStart(5, "0")}`;
  }
  const compact = s.replace(/[^a-z0-9-]/g, "");
  return compact || null;
}

export function caseKey(courtId: string | null | undefined, docketNumber: string | null | undefined, fallback: string): string {
  const dn = normalizeDocketNumber(docketNumber);
  if (courtId && dn) return `${courtId}|${dn}`;
  return fallback;
}

export function categoryFor(court: CourtRef, docketNumber: string | null, extra: { suitNature?: string | null; jurisdictionType?: string | null; chapter?: unknown }): CaseCategory {
  if (court.type === "bankruptcy" || (extra.chapter != null && extra.chapter !== "")) return "bankruptcy";
  if (court.type === "appellate" || court.type === "supreme") return "appeal";
  const dn = (docketNumber ?? "").toLowerCase();
  if (/-cr-|\bcr\b|-mj-/.test(dn) || /criminal/i.test(extra.jurisdictionType ?? "")) return "criminal";
  if (/-cv-|-bk-|-ap-/.test(dn) || extra.suitNature || /question|diversity|government/i.test(extra.jurisdictionType ?? "")) {
    return dn.includes("-bk-") || dn.includes("-ap-") ? "bankruptcy" : "civil";
  }
  return court.type === "trial" ? "unknown" : "other";
}

export function statusFor(dateTerminated: string | null | undefined, hasDocketData: boolean): { status: CaseStatus; basis: string } {
  if (dateTerminated) return { status: "closed", basis: `Termination date recorded in source: ${dateTerminated}` };
  if (hasDocketData) return { status: "active", basis: "No termination date recorded in the source docket (treated as open)" };
  return { status: "unknown", basis: "Status not reported by source" };
}

export function captionParties(caseName: string): PartyRef[] {
  return captionSides(caseName).map((side) => ({
    name: side,
    role: null,
    roleSource: "caption" as const,
    isOrganization: looksLikeOrganization(side),
    providerPartyId: null,
  }));
}

function listParties(names: string[] | null | undefined): PartyRef[] {
  return (names ?? []).map((n) => ({
    name: n,
    role: null,
    roleSource: "unknown" as const,
    isOrganization: looksLikeOrganization(n) && !isPlaceholderParty(n),
    providerPartyId: null,
  }));
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function source(ctx: MapContext, kind: SourceRef["kind"], id: string, url: string | null, label: string, indexedAt: string | null | undefined): SourceRef {
  return { provider: ctx.provider, kind, providerRecordId: id, url, label, live: ctx.live, indexedAt: indexedAt ?? null, retrievedAt: ctx.retrievedAt };
}

/* ------------------------------------------------------------- search maps */

export function mapRecapDocumentHit(d: TRecapDocumentHit, ctx: MapContext, phrases: string[]): DocumentHit {
  const title = collapseWhitespace(d.short_description || d.description || "Docket document").slice(0, 200);
  const snippet =
    buildSnippet(d.snippet, null, phrases, "document_text") ??
    (d.description ? buildSnippet(null, d.description, phrases, "entry_description") : null);
  return {
    id: `cl-rd-${d.id}`,
    provider: ctx.provider,
    title,
    kind: d.attachment_number ? "attachment" : "filing",
    date: d.entry_date_filed ?? null,
    entryNumber: d.entry_number != null ? String(d.entry_number) : null,
    documentNumber: d.document_number != null ? String(d.document_number) : null,
    url: absUrl(d.absolute_url),
    downloadUrl: d.is_available ? storageUrl(d.filepath_local) : null,
    available: d.is_available ?? null,
    pageCount: d.page_count ?? null,
    snippet,
    docketId: d.docket_id != null ? String(d.docket_id) : null,
  };
}

export function mapDocketSearchResult(r: TDocketSearchResult, ctx: MapContext, phrases: string[]): ProviderRecordHit {
  const court = ctx.getCourt(r.court_id, r.court, r.court_citation_string);
  const caseName = collapseWhitespace((r.caseName ?? "").replace(/<[^>]+>.*$/, "")) || "Untitled case";
  const partyNames = (r.party ?? []).filter(Boolean);
  const captured = partyNames.length > 0;
  const { status, basis } = statusFor(r.dateTerminated, true);
  const docs = (r.recap_documents ?? []).map((d) => mapRecapDocumentHit(d, ctx, phrases));
  const docketUrl = absUrl(r.docket_absolute_url);
  const record: CaseRecord = {
    key: caseKey(court.id, r.docketNumber, `cl-docket-${r.docket_id}`),
    caseName,
    court,
    docketNumber: r.docketNumber ?? null,
    dateFiled: r.dateFiled ?? null,
    dateTerminated: r.dateTerminated ?? null,
    lastActivity: null,
    status,
    statusBasis: basis,
    category: categoryFor(court, r.docketNumber ?? null, { suitNature: r.suitNature, jurisdictionType: r.jurisdictionType, chapter: r.chapter }),
    natureOfSuit: r.suitNature || null,
    cause: r.cause || null,
    judge: cleanJudgeName(r.assignedTo),
    parties: captured ? listParties(partyNames) : captionParties(caseName),
    partyListCaptured: captured,
    attorneys: cleanAttorneys(r.attorney ?? []),
    // The firm field occasionally repeats an attorney's own name; that is not a firm.
    firms: cleanFirms(r.firm ?? []).filter((f) => !cleanAttorneys(r.attorney ?? []).some((a) => normalizeName(a.name) === normalizeName(f))),
    opinions: [],
    documents: docs,
    sources: [source(ctx, "docket", String(r.docket_id), docketUrl, "CourtListener RECAP docket", r.meta?.timestamp)],
    kinds: ["docket"],
    citations: [],
    providerDocketId: String(r.docket_id),
    bankruptcyChapter: r.chapter != null && r.chapter !== "" ? String(r.chapter) : null,
  };
  return {
    source: "dockets",
    record,
    evidence: {
      partyNames,
      attorneyNames: (r.attorney ?? []).map((n) => cleanAttorneyName(n).name),
      firmNames: cleanFirms(r.firm ?? []),
      caseName,
      documents: docs,
      opinionSnippet: null,
    },
    providerScore: r.meta?.score?.bm25 ?? null,
  };
}

export function mapOpinionSearchResult(r: TOpinionSearchResult, ctx: MapContext, phrases: string[]): ProviderRecordHit {
  const court = ctx.getCourt(r.court_id, r.court, r.court_citation_string);
  const caseName = collapseWhitespace(r.caseName ?? "") || "Untitled decision";
  const first = r.opinions?.[0];
  const url = absUrl(r.absolute_url);
  const opinion: OpinionRef = {
    id: first ? String(first.id) : String(r.cluster_id),
    clusterId: String(r.cluster_id),
    caseName,
    dateFiled: r.dateFiled ?? null,
    url,
    downloadUrl: first?.local_path ? storageUrl(first.local_path) : first?.download_url ?? null,
    citations: r.citation ?? [],
    status: r.status ?? null,
    type: first?.type ?? null,
    judge: cleanJudgeName(r.judge),
  };
  const snippet = first ? buildSnippet(first.snippet, null, phrases, "opinion_text") ?? excerpt(first.snippet, "opinion_text") : null;
  const opinionHit: DocumentHit = {
    id: `cl-op-${opinion.id}`,
    provider: ctx.provider,
    title: `${caseName} — ${first?.type ? first.type.replace(/-/g, " ") : "opinion"}`,
    kind: "opinion",
    date: r.dateFiled ?? null,
    entryNumber: null,
    documentNumber: null,
    url,
    downloadUrl: opinion.downloadUrl,
    available: true,
    pageCount: null,
    snippet,
    docketId: r.docket_id != null ? String(r.docket_id) : null,
  };
  const record: CaseRecord = {
    key: caseKey(court.id, r.docketNumber, `cl-cluster-${r.cluster_id}`),
    caseName,
    court,
    docketNumber: r.docketNumber ?? null,
    dateFiled: null,
    dateTerminated: null,
    lastActivity: r.dateFiled ?? null,
    status: "unknown",
    statusBasis: "Opinion records do not report case status",
    category: categoryFor(court, r.docketNumber ?? null, { suitNature: r.suitNature }),
    natureOfSuit: r.suitNature || null,
    cause: null,
    judge: cleanJudgeName(r.judge),
    parties: captionParties(caseName),
    partyListCaptured: false,
    attorneys: [],
    firms: [],
    opinions: [opinion],
    documents: [],
    sources: [source(ctx, "opinion", String(r.cluster_id), url, "CourtListener case law", r.meta?.timestamp)],
    kinds: ["opinion"],
    citations: r.citation ?? [],
    providerDocketId: r.docket_id != null ? String(r.docket_id) : null,
    bankruptcyChapter: null,
  };
  return {
    source: "opinions",
    record,
    evidence: {
      partyNames: [],
      attorneyNames: r.attorney ? [r.attorney] : [],
      firmNames: [],
      caseName,
      documents: [],
      opinionSnippet: opinionHit,
    },
    providerScore: r.meta?.score?.bm25 ?? null,
  };
}

/* ------------------------------------------------------------ docket detail */

const ENTRY_RULES: { cat: DocketEntryCategory; re: RegExp }[] = [
  { cat: "judgment", re: /\b(judgment|verdict)\b/i },
  { cat: "appeal", re: /\b(notice of appeal|usca|mandate|court of appeals)\b/i },
  { cat: "order", re: /^(\s*(minute |scheduling |protective |clerk'?s? )?order\b|.*\border (granting|denying|re|by judge|setting|regarding)\b)/i },
  { cat: "complaint", re: /^\s*((first |second |third )?amended )?(complaint|petition|notice of removal|indictment|information)\b/i },
  { cat: "transcript", re: /^\s*transcript\b/i },
  { cat: "hearing", re: /\b(hearing|minute entry|proceedings held|status conference|trial)\b/i },
  { cat: "stipulation", re: /\bstipulat/i },
  { cat: "motion", re: /^\s*((joint|administrative|emergency|ex parte) )?motion\b/i },
  { cat: "brief", re: /^\s*(brief|memorandum|opposition|reply|response)\b/i },
  { cat: "notice", re: /^\s*notice\b/i },
];

export function categorizeEntry(description: string): DocketEntryCategory {
  for (const r of ENTRY_RULES) if (r.re.test(description)) return r.cat;
  return "other";
}

const IMPORTANT: DocketEntryCategory[] = ["judgment", "order", "appeal", "complaint"];

const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;

function toIso(m: RegExpMatchArray): string | null {
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? `20${yy}` : yy;
  const iso = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Extracts explicit deadlines/settings stated in the entry text ("Responses due by 8/27/2026"). */
/**
 * Dates the docket text itself states ("Responses due by 8/17/2026", "Hearing set for …").
 * The label is the short phrase right before the trigger, cut at the nearest punctuation,
 * so "(Re 1703 Transcript Order ) Release of Transcript Restriction set for 11/16/2026"
 * yields "Release of Transcript Restriction set for 11/16/2026".
 */
export function extractDeadlines(description: string): { date: string; text: string }[] {
  const out: { date: string; text: string }[] = [];
  const re = /\b(due by|set for|deadline(?: set)?(?: for)?|reset for|continued to)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    const dm = m[2].match(DATE_RE);
    const iso = dm ? toIso(dm) : null;
    if (!iso) continue;
    const before = description.slice(Math.max(0, m.index - 120), m.index);
    const segment = before.split(/[.;:()[\],]/).pop() ?? "";
    const words = segment.trim().split(/\s+/).filter(Boolean).slice(-6);
    const label = words.join(" ");
    out.push({ date: iso, text: collapseWhitespace(`${label ? `${label} ` : ""}${m[1].toLowerCase()} ${m[2]}`) });
  }
  return out;
}

export function mapDocketEntry(e: TDocketEntry, ctx: MapContext, docketId: string): DocketEntry {
  const description = collapseWhitespace(e.description ?? "");
  const category = categorizeEntry(description);
  const docs: DocumentHit[] = (e.recap_documents ?? []).map((d) => ({
    id: `cl-rd-${d.id}`,
    provider: ctx.provider,
    title: collapseWhitespace(d.description || (d.attachment_number ? `Attachment ${d.attachment_number}` : "Main document")),
    kind: d.attachment_number ? "attachment" : "filing",
    date: e.date_filed ?? null,
    entryNumber: e.entry_number != null ? String(e.entry_number) : null,
    documentNumber: d.document_number != null ? String(d.document_number) : null,
    url: absUrl(d.absolute_url),
    downloadUrl: d.is_available ? storageUrl(d.filepath_local) : null,
    available: d.is_available ?? null,
    pageCount: d.page_count ?? null,
    snippet: null,
    docketId,
  }));
  return {
    id: `cl-de-${e.id}`,
    entryNumber: e.entry_number != null ? String(e.entry_number) : null,
    dateFiled: e.date_filed ?? null,
    description: description || "(No description in source)",
    category,
    important: IMPORTANT.includes(category),
    deadlines: extractDeadlines(description),
    documents: docs,
  };
}

export function mapParties(parties: TParty[], attorneysById: Map<number, TAttorney>, docketId: string): { parties: PartyRef[]; attorneys: AttorneyRef[] } {
  const partyRefs: PartyRef[] = [];
  const attorneyMap = new Map<string, AttorneyRef>();
  for (const p of parties) {
    const name = collapseWhitespace(p.name ?? "");
    if (!name) continue;
    const roles = uniq((p.party_types ?? []).filter((t) => t.docket_id == null || String(t.docket_id) === docketId).map((t) => t.name ?? "").filter(Boolean));
    partyRefs.push({
      name,
      role: roles.length ? roles.join(" / ") : null,
      roleSource: roles.length ? "party_record" : "unknown",
      isOrganization: looksLikeOrganization(name) && !isPlaceholderParty(name),
      providerPartyId: String(p.id),
    });
    for (const link of p.attorneys ?? []) {
      if (link.docket_id != null && String(link.docket_id) !== docketId) continue;
      if (link.attorney_id == null) continue;
      const a = attorneysById.get(link.attorney_id);
      const key = String(link.attorney_id);
      const ref = attorneyMap.get(key) ?? {
        name: collapseWhitespace(a?.name ?? `Attorney #${link.attorney_id}`),
        providerAttorneyId: key,
        roles: [],
        representing: [],
      };
      const roleLabel = link.role != null ? ATTORNEY_ROLES[link.role] ?? `Role ${link.role}` : null;
      if (roleLabel && !ref.roles.includes(roleLabel)) ref.roles.push(roleLabel);
      if (!ref.representing.includes(name)) ref.representing.push(name);
      attorneyMap.set(key, ref);
    }
  }
  return { parties: partyRefs, attorneys: [...attorneyMap.values()] };
}

export function mapDocketDetail(d: TDocket, ctx: MapContext): Omit<DocketDetail, "entries" | "entriesNextCursor" | "entriesTotalKnown" | "partiesDetailed"> {
  const court = ctx.getCourt(d.court_id);
  const caseName = collapseWhitespace(d.case_name || d.case_name_full || d.case_name_short || "") || "Untitled case";
  const { status, basis } = statusFor(d.date_terminated, true);
  const url = absUrl(d.absolute_url);
  const record: CaseRecord = {
    key: caseKey(court.id, d.docket_number, `cl-docket-${d.id}`),
    caseName,
    court,
    docketNumber: d.docket_number ?? null,
    dateFiled: d.date_filed ?? null,
    dateTerminated: d.date_terminated ?? null,
    lastActivity: d.date_last_filing ?? null,
    status,
    statusBasis: basis,
    category: categoryFor(court, d.docket_number ?? null, { suitNature: d.nature_of_suit, jurisdictionType: d.jurisdiction_type }),
    natureOfSuit: d.nature_of_suit || null,
    cause: d.cause || null,
    judge: cleanJudgeName(d.assigned_to_str),
    parties: captionParties(caseName),
    partyListCaptured: false,
    attorneys: [],
    firms: [],
    opinions: [],
    documents: [],
    sources: [source(ctx, "docket", String(d.id), url, "CourtListener RECAP docket", d.date_modified)],
    kinds: ["docket"],
    citations: [],
    providerDocketId: String(d.id),
    bankruptcyChapter: null,
  };
  return { record, dateLastFiling: d.date_last_filing ?? null, dateModified: d.date_modified ?? null };
}

/** Pulls a docket id out of a CourtListener absolute URL like /docket/71469626/23/slug/. */
export function docketIdFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/\/docket\/(\d+)\//);
  return m ? m[1] : null;
}
