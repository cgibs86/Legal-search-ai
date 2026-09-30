import type { AttorneyRef, CaseRecord, DocumentHit, MatchInfo, MatchType, OpinionRef, PartyRef, SearchHit, SourceRef } from "@/lib/domain/types";

/**
 * The same matter can arrive from several sources (docket search, opinion search, filing
 * search, PACER). Records sharing a normalized key (court + normalized docket number) are
 * merged into one case with multiple source badges.
 */

function uniqBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of xs) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function maxDate(...ds: (string | null)[]): string | null {
  const v = ds.filter(Boolean) as string[];
  return v.length ? v.sort().at(-1)! : null;
}

function mergeParties(a: PartyRef[], b: PartyRef[], aCaptured: boolean, bCaptured: boolean): PartyRef[] {
  // Prefer party lists captured from a docket party record over caption-derived ones.
  if (aCaptured && !bCaptured) return a;
  if (bCaptured && !aCaptured) return b;
  const byName = new Map<string, PartyRef>();
  for (const p of [...a, ...b]) {
    const k = p.name.toLowerCase();
    const prev = byName.get(k);
    if (!prev || (prev.roleSource !== "party_record" && p.roleSource === "party_record")) byName.set(k, p);
  }
  return [...byName.values()];
}

function mergeAttorneys(a: AttorneyRef[], b: AttorneyRef[]): AttorneyRef[] {
  const byName = new Map<string, AttorneyRef>();
  for (const x of [...a, ...b]) {
    const k = x.name.toLowerCase();
    const prev = byName.get(k);
    byName.set(k, prev ? { ...prev, roles: [...new Set([...prev.roles, ...x.roles])], representing: [...new Set([...prev.representing, ...x.representing])] } : x);
  }
  return [...byName.values()];
}

export function mergeRecords(a: CaseRecord, b: CaseRecord): CaseRecord {
  const aDocket = a.kinds.includes("docket");
  const bDocket = b.kinds.includes("docket");
  const primary = aDocket || !bDocket ? a : b;
  const other = primary === a ? b : a;
  return {
    ...primary,
    caseName: primary.caseName.includes("(title from source URL)") ? other.caseName : primary.caseName,
    court: primary.court.level === "other" ? other.court : primary.court,
    docketNumber: primary.docketNumber ?? other.docketNumber,
    dateFiled: primary.dateFiled ?? other.dateFiled,
    dateTerminated: primary.dateTerminated ?? other.dateTerminated,
    lastActivity: maxDate(primary.lastActivity, other.lastActivity),
    status: primary.status !== "unknown" ? primary.status : other.status,
    statusBasis: primary.status !== "unknown" ? primary.statusBasis : other.statusBasis,
    category: primary.category !== "unknown" ? primary.category : other.category,
    natureOfSuit: primary.natureOfSuit ?? other.natureOfSuit,
    cause: primary.cause ?? other.cause,
    judge: primary.judge ?? other.judge,
    parties: mergeParties(primary.parties, other.parties, primary.partyListCaptured, other.partyListCaptured),
    partyListCaptured: primary.partyListCaptured || other.partyListCaptured,
    attorneys: mergeAttorneys(primary.attorneys, other.attorneys),
    firms: [...new Set([...primary.firms, ...other.firms])],
    opinions: uniqBy<OpinionRef>([...primary.opinions, ...other.opinions], (o) => o.clusterId),
    documents: uniqBy<DocumentHit>([...primary.documents, ...other.documents], (d) => d.id),
    sources: uniqBy<SourceRef>([...primary.sources, ...other.sources], (s) => `${s.provider}:${s.kind}:${s.providerRecordId}`),
    kinds: [...new Set([...primary.kinds, ...other.kinds])],
    citations: [...new Set([...primary.citations, ...other.citations])],
    providerDocketId: primary.providerDocketId ?? other.providerDocketId,
    bankruptcyChapter: primary.bankruptcyChapter ?? other.bankruptcyChapter,
  };
}

const FIELD_PRECEDENCE: MatchInfo["field"][] = ["docket_number", "party", "caption", "attorney", "firm", "entry_description", "document_text", "opinion_text"];

export function mergeMatches(a: MatchInfo, b: MatchInfo): MatchInfo {
  const first = FIELD_PRECEDENCE.indexOf(a.field) <= FIELD_PRECEDENCE.indexOf(b.field) ? a : b;
  const second = first === a ? b : a;
  let types = new Set<MatchType>([...a.types, ...b.types]);
  // A strong party match from one source outranks a "possible identity" flag from a weaker one,
  // but only when the strong match used the exact/equivalent name.
  const strong = [a, b].some((m) => (m.field === "party" || m.field === "docket_number") && !m.types.includes("possible_identity"));
  if (strong) types = new Set([...types].filter((t) => t !== "possible_identity"));
  return {
    ...first,
    types: [...types],
    partyRole: first.partyRole ?? second.partyRole,
    reasons: [...new Set([...first.reasons, ...second.reasons])],
    mentions: uniqBy([...first.mentions, ...second.mentions], (d) => d.id),
  };
}

export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const byKey = new Map<string, SearchHit>();
  for (const h of hits) {
    const prev = byKey.get(h.record.key);
    if (!prev) {
      byKey.set(h.record.key, h);
      continue;
    }
    byKey.set(h.record.key, {
      id: prev.id,
      record: mergeRecords(prev.record, h.record),
      match: mergeMatches(prev.match, h.match),
      score: Math.max(prev.score, h.score) + 2,
    });
  }
  return [...byKey.values()];
}
