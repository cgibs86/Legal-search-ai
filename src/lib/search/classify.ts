import type { EntityType, QueryClassification } from "@/lib/domain/types";
import { collapseWhitespace, looksLikeLawFirm, looksLikeOrganization, normalizeName } from "@/lib/text/names";

export const MAX_QUERY_LENGTH = 160;

const FEDERAL_DOCKET = /^(?:no\.?\s*)?(?:(\d{1,2}):)?(\d{2}|\d{4})-?([a-z]{2,4})-?(\d{2,6})(?:-[a-z]{2,5})*$/i;
const APPELLATE_DOCKET = /^(?:no\.?\s*)?(\d{2})-(\d{2,5})$/i;
const GENERIC_DOCKET = /^(?:no\.?\s*)?[0-9a-z]{1,5}(?:[-:][0-9a-z]{1,8}){2,5}$/i;
const PERSON_TOKEN = /^[a-z][a-z'’\-]*\.?$/i;
const INITIAL = /^[a-z]\.?$/i;

export interface InvalidQuery {
  valid: false;
  reason: string;
}

export function validateQuery(raw: string): { valid: true; query: string } | InvalidQuery {
  const q = collapseWhitespace(raw.replace(/[\u0000-\u001f\u007f]/g, " "));
  if (q.length < 2) return { valid: false, reason: "Enter at least two characters." };
  if (q.length > MAX_QUERY_LENGTH) return { valid: false, reason: `Keep searches under ${MAX_QUERY_LENGTH} characters.` };
  if (!/[a-z0-9]/i.test(q)) return { valid: false, reason: "Search must include letters or numbers." };
  if (/(^|\s)[!*?]/.test(q) || /\*/.test(q)) return { valid: false, reason: "Wildcards aren't supported. Search a full name, company or docket number." };
  const quotes = (q.match(/"/g) ?? []).length;
  if (quotes % 2 === 1) return { valid: false, reason: "Unbalanced quotation mark." };
  return { valid: true, query: q.replace(/"/g, "") };
}

/**
 * Guesses what the user typed. The result drives variant generation and which provider
 * fields are searched; the UI shows the guess and lets the user override it.
 */
export function classifyQuery(raw: string): QueryClassification {
  let q = collapseWhitespace(raw);
  const normalized = normalizeName(q);
  const candidates: QueryClassification["candidates"] = [];

  const attorneyMarker = /^(atty|attorney|counsel)\s*:\s*/i.test(q) || /,?\s+esq\.?$/i.test(q);
  if (attorneyMarker) q = q.replace(/^(atty|attorney|counsel)\s*:\s*/i, "").replace(/,?\s+esq\.?$/i, "");

  const compact = q.replace(/\s+/g, "");
  const fed = compact.match(FEDERAL_DOCKET);
  const app = compact.match(APPELLATE_DOCKET);
  if (fed || app || (GENERIC_DOCKET.test(compact) && /\d{2,}/.test(compact) && /\d/.test(compact.replace(/^\D+/, "")))) {
    const hasLetters = /[a-z]/i.test(compact);
    if (fed || app || hasLetters || compact.split(/[-:]/).length >= 3) {
      candidates.push({ type: "docket_number", confidence: fed || app ? 0.95 : 0.75, reason: "Looks like a docket number" });
      return {
        primary: "docket_number",
        candidates,
        normalized,
        docketNumber: { raw: q, normalized: compact.replace(/^no\.?/i, "").toLowerCase(), courtHint: null },
      };
    }
  }

  if (/\s(v\.?|vs\.?|versus)\s/i.test(` ${q} `) || /^in re\b/i.test(q)) {
    candidates.push({ type: "case", confidence: 0.9, reason: "Looks like a case caption" });
  }
  if (attorneyMarker) candidates.push({ type: "attorney", confidence: 0.9, reason: "Marked as an attorney" });
  if (looksLikeLawFirm(q)) candidates.push({ type: "law_firm", confidence: 0.85, reason: "Contains a law-firm designation (LLP, PLLC, Law Group…)" });
  if (looksLikeOrganization(q)) candidates.push({ type: "company", confidence: 0.8, reason: "Contains an organization word or entity suffix" });

  const tokens = q.split(/\s+/);
  const personLike = tokens.length >= 2 && tokens.length <= 5 && tokens.every((t) => PERSON_TOKEN.test(t) || INITIAL.test(t) || /^(jr|sr|ii|iii|iv)\.?,?$/i.test(t)) && !looksLikeOrganization(q);
  const lastFirst = /^[a-z'’\-]+,\s*[a-z]/i.test(q) && !looksLikeOrganization(q);
  if (personLike || lastFirst) candidates.push({ type: attorneyMarker ? "attorney" : "person", confidence: tokens.length >= 3 ? 0.75 : 0.65, reason: "Looks like a personal name" });
  if (!attorneyMarker && (personLike || lastFirst)) candidates.push({ type: "attorney", confidence: 0.3, reason: "Could also be an attorney of record" });

  if (candidates.length === 0) {
    candidates.push({ type: "company", confidence: 0.45, reason: "Single name — could be a company or a surname" });
    candidates.push({ type: "person", confidence: 0.3, reason: "Could be a surname" });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const primary: EntityType = candidates[0].confidence >= 0.5 ? candidates[0].type : "unknown";
  return { primary, candidates: dedupeCandidates(candidates), normalized, docketNumber: null };
}

function dedupeCandidates(c: QueryClassification["candidates"]): QueryClassification["candidates"] {
  const seen = new Set<EntityType>();
  return c.filter((x) => (seen.has(x.type) ? false : (seen.add(x.type), true)));
}

export const ENTITY_LABELS: Record<EntityType, string> = {
  person: "Person",
  company: "Company",
  attorney: "Attorney",
  law_firm: "Law firm",
  case: "Case",
  docket_number: "Docket number",
  unknown: "Name",
};
