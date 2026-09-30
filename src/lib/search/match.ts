import type { EntityType, MatchInfo, MatchType, NameVariant, SearchHit, VariantKind } from "@/lib/domain/types";
import type { ProviderRecordHit } from "@/lib/providers/types";
import {
  captionSides,
  comparePersonNames,
  containsPhrase,
  normalizeName,
  parseCompanyName,
  parsePersonName,
} from "@/lib/text/names";
import { normalizeDocketNumber } from "@/lib/providers/courtlistener/mappers";

export type NameRelation = "exact" | "equivalent" | "weaker";

export interface NameMatch {
  candidate: string;
  variant: NameVariant;
  relation: NameRelation;
  note: string | null;
}

const PERSON_TYPES: EntityType[] = ["person", "attorney"];

export const IDENTITY_NOTE =
  "Name match only. A matching name does not establish that this record concerns the person you searched.";

function strengthToRelation(v: NameVariant): NameRelation {
  return v.strength === "exact" ? "exact" : v.strength === "equivalent" ? "equivalent" : "weaker";
}

function weakest(a: NameRelation, b: NameRelation): NameRelation {
  const order: NameRelation[] = ["exact", "equivalent", "weaker"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

/** Compares a name listed in a record against the query variants. */
export function matchName(candidate: string, variants: NameVariant[], type: EntityType): NameMatch | null {
  if (!candidate) return null;
  const exactVariant = variants[0];
  if (PERSON_TYPES.includes(type)) {
    const q = parsePersonName(exactVariant.text);
    // Party strings often carry qualifiers: "John Smith, individually and as trustee".
    const head = candidate.split(/,\s*(individually|as |d\/b\/a|dba|et al)/i)[0];
    const c = parsePersonName(head);
    const rel = comparePersonNames(q, c);
    if (rel === "identical") return { candidate, variant: exactVariant, relation: "exact", note: head !== candidate ? `Listed as "${candidate}"` : null };
    if (rel === "compatible") {
      const via = variants.find((v) => v.strength !== "exact" && comparePersonNames(parsePersonName(v.text), c) === "identical") ?? variants[variants.length - 1];
      return { candidate, variant: via, relation: "weaker", note: `Listed as "${candidate}" — compatible with, but not identical to, your search` };
    }
    for (const v of variants) {
      if (containsPhrase(candidate, v.text)) return { candidate, variant: v, relation: strengthToRelation(v), note: `Name appears within "${candidate}"` };
    }
    return null;
  }

  const q = parseCompanyName(exactVariant.text);
  // Drop descriptive qualifiers: "Acme, Inc., a Delaware corporation", "Acme LLC d/b/a Acme Stores".
  const head = candidate.split(/,\s*(?:an?\s+[a-z .]*?(?:corporation|company|limited liability company|partnership|entity)\b|individually|as\s)|\s+(?:d\/b\/a|dba|f\/k\/a|fka|a\/k\/a|aka)\s/i)[0];
  const c = parseCompanyName(head);
  if (q.core && c.core === q.core) {
    if (!q.suffixClass || !c.suffixClass || q.suffixClass === c.suffixClass) {
      const relation: NameRelation = q.suffixClass && c.suffixClass ? "exact" : "equivalent";
      return { candidate, variant: exactVariant, relation, note: normalizeName(candidate) !== normalizeName(exactVariant.text) ? `Listed as "${candidate}"` : null };
    }
    return { candidate, variant: exactVariant, relation: "weaker", note: `Listed as "${candidate}" — different entity suffix; may be a different entity` };
  }
  for (const v of variants) {
    const vc = parseCompanyName(v.text).core;
    if (vc && ` ${c.core} `.includes(` ${vc} `)) {
      return { candidate, variant: v, relation: weakest("weaker", strengthToRelation(v)), note: `Name appears within "${candidate}" — may be a different entity` };
    }
  }
  return null;
}

function bestMatch(names: string[], variants: NameVariant[], type: EntityType): NameMatch | null {
  let best: NameMatch | null = null;
  const rank: Record<NameRelation, number> = { exact: 0, equivalent: 1, weaker: 2 };
  for (const n of names) {
    const m = matchName(n, variants, type);
    if (m && (!best || rank[m.relation] < rank[best.relation])) best = m;
    if (best?.relation === "exact") break;
  }
  return best;
}

export interface ClassifyContext {
  entityType: EntityType;
  variants: NameVariant[];
  docketNumber: string | null;
}

function base(types: MatchType[], field: MatchInfo["field"], m: NameMatch | null, reasons: string[], ctx: ClassifyContext): MatchInfo {
  const isPerson = PERSON_TYPES.includes(ctx.entityType);
  const t = new Set(types);
  if (m?.relation === "weaker") t.add("possible_identity");
  return {
    types: [...t],
    field,
    matchedText: m?.candidate ?? "",
    matchedVariant: m?.variant.text ?? ctx.variants[0]?.text ?? "",
    variantKind: (m?.variant.kind ?? "exact") as VariantKind,
    partyRole: null,
    reasons: [...reasons, ...(m?.note ? [m.note] : [])],
    identityNote: isPerson ? IDENTITY_NOTE : null,
    mentions: [],
  };
}

/**
 * Decides how a provider hit relates to the searched entity. Returns null only when the
 * hit is irrelevant to the query type (e.g. an opinion hit in docket mode).
 */
export function classifyHit(hit: ProviderRecordHit, ctx: ClassifyContext): MatchInfo | null {
  const { record, evidence } = hit;
  const type = ctx.entityType;

  if (type === "docket_number") {
    const want = normalizeDocketNumber(ctx.docketNumber);
    const got = normalizeDocketNumber(record.docketNumber);
    const same = want && got && want === got;
    const info = base(hit.source === "opinions" ? ["docket"] : ["docket"], "docket_number", null, [same ? "Docket number matches exactly" : "Returned by the provider's docket-number search"], ctx);
    info.matchedText = record.docketNumber ?? "";
    info.matchedVariant = ctx.docketNumber ?? "";
    if (!same) info.types.push("possible_identity");
    if (hit.source === "opinions") info.reasons.push("A published decision exists on this docket");
    return info;
  }

  if (type === "case") {
    const m = containsPhrase(record.caseName, ctx.variants[0].text);
    const info = base(["docket"], "caption", null, [m ? "Case caption matches" : "Returned by the provider's case-name search"], ctx);
    info.matchedText = record.caseName;
    if (!m) info.types.push("possible_identity");
    return info;
  }

  if (hit.source === "dockets" || hit.source === "pacer_parties" || hit.source === "pacer_cases") {
    if (type === "attorney" || type === "law_firm") {
      const counsel = bestMatch(type === "law_firm" ? evidence.firmNames : evidence.attorneyNames, ctx.variants, type === "law_firm" ? "company" : "person");
      if (counsel) {
        return base(["attorney", "docket"], type === "law_firm" ? "firm" : "attorney", counsel, [type === "law_firm" ? "Listed among counsel firms on the docket" : "Listed as counsel of record on the docket"], ctx);
      }
    }
    const party = bestMatch(evidence.partyNames, ctx.variants, type === "law_firm" ? "company" : type);
    if (party) {
      const info = base(["party", "docket"], "party", party, ["Listed as a party on the federal docket"], ctx);
      const role = evidence.pacerPartyRole ?? record.parties.find((p) => p.name === party.candidate && p.roleSource === "party_record")?.role ?? null;
      info.partyRole = role;
      if (role) info.reasons.push(`Party role: ${role}`);
      return info;
    }
    const side = captionSides(evidence.caseName);
    const caption = bestMatch(side, ctx.variants, type === "law_firm" ? "company" : type);
    if (caption) {
      const idx = side.findIndex((s) => s === caption.candidate);
      const info = base(["party", "docket"], "caption", caption, [
        "Named in the docket caption",
        record.partyListCaptured ? "Not found in the captured party list" : "Full party list not captured for this docket",
      ], ctx);
      info.partyRole = idx === 0 ? "First-named party in caption" : idx > 0 ? "Opposing party in caption" : null;
      return info;
    }
    if (type !== "attorney") {
      const counsel = bestMatch(evidence.attorneyNames, ctx.variants, type === "law_firm" ? "company" : "person");
      if (counsel) return base(["attorney", "docket"], "attorney", counsel, ["Listed as counsel of record on the docket"], ctx);
    }
    const info = base(["docket", "possible_identity"], "party", null, ["Returned by the provider's party/caption search, but the exact name was not found in the retrieved fields"], ctx);
    return info;
  }

  if (hit.source === "opinions") {
    const side = captionSides(evidence.caseName);
    const caption = bestMatch(side, ctx.variants, type === "law_firm" ? "company" : type);
    if (caption) {
      const info = base(["party"], "caption", caption, ["Named in the caption of a court decision"], ctx);
      const idx = side.findIndex((s) => s === caption.candidate);
      info.partyRole = idx === 0 ? "First-named party in caption" : idx > 0 ? "Opposing party in caption" : null;
      if (evidence.opinionSnippet) info.mentions = [evidence.opinionSnippet];
      return info;
    }
    if (type === "attorney" || type === "law_firm") {
      const counsel = ctx.variants.find((v) => evidence.attorneyNames.some((a) => containsPhrase(a, v.text)));
      if (counsel) return base(["attorney"], "attorney", { candidate: counsel.text, variant: counsel, relation: strengthToRelation(counsel), note: null }, ["Named among counsel in the published decision"], ctx);
    }
    const snippet = evidence.opinionSnippet;
    const highlighted = snippet?.snippet?.source === "provider_highlight" || snippet?.snippet?.source === "local_match";
    const info = base(["mention"], "opinion_text", null, [
      "Named in the text of a court decision; not named in its caption",
      highlighted ? "Context highlighted from the source text" : "The provider's full-text search matched this decision; highlighted context was not returned",
    ], ctx);
    info.matchedText = ctx.variants[0].text;
    if (ctx.variants.length && PERSON_TYPES.includes(type)) info.types.push("possible_identity");
    info.mentions = snippet ? [snippet] : [];
    return info;
  }

  if (hit.source === "filings") {
    const docs = evidence.documents;
    const party = bestMatch(evidence.partyNames, ctx.variants, type === "law_firm" ? "company" : type) ?? bestMatch(captionSides(evidence.caseName), ctx.variants, type === "law_firm" ? "company" : type);
    if (party) {
      const info = base(["party", "docket"], "party", party, ["Named in filings on a docket where the name is also a listed party"], ctx);
      info.mentions = docs;
      return info;
    }
    const info = base(["mention"], docs.some((d) => d.snippet?.field === "entry_description") ? "entry_description" : "document_text", null, [
      "Named in a court filing",
      record.partyListCaptured ? "Not a listed party in this docket's captured party list" : "The docket's party list was not available to confirm party status",
    ], ctx);
    info.matchedText = ctx.variants[0].text;
    if (PERSON_TYPES.includes(type)) info.types.push("possible_identity");
    info.mentions = docs;
    return info;
  }
  return null;
}

const FIELD_SCORE: Record<MatchInfo["field"], number> = {
  docket_number: 100,
  party: 95,
  caption: 88,
  attorney: 80,
  firm: 78,
  entry_description: 55,
  document_text: 52,
  opinion_text: 50,
};

export function scoreHit(match: MatchInfo, providerScore: number | null, index: number): number {
  let s = FIELD_SCORE[match.field];
  if (match.types.includes("possible_identity")) s -= 18;
  if (match.variantKind !== "exact" && match.variantKind !== "last_first") s -= 6;
  // Preserve provider relevance order within a tier without letting it dominate.
  s += Math.max(0, 5 - index * 0.25);
  if (providerScore != null && Number.isFinite(providerScore)) s += Math.min(3, Math.log10(1 + Math.max(0, providerScore)));
  return Math.round(s * 100) / 100;
}

export function toSearchHit(hit: ProviderRecordHit, match: MatchInfo, index: number): SearchHit {
  return { id: hit.record.key, record: hit.record, match, score: scoreHit(match, hit.providerScore, index) };
}
