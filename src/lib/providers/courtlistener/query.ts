import type { EntityQuery } from "@/lib/providers/types";
import type { SearchFilters, SortOrder } from "@/lib/domain/types";

/**
 * Builds CourtListener v4 Search API parameters from a provider-neutral query.
 * Pure (no I/O) so it is unit-tested directly. Court restrictions are passed in already
 * resolved so this module stays independent of the courts dataset.
 */

export type ClSearchType = "d" | "o" | "rd";

export function quotePhrase(s: string): string {
  // Balanced quotes are required by the search engine; strip any inside the phrase.
  return `"${s.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

export function orPhrases(phrases: string[], proximity: (p: string) => number = () => 0): string {
  const uniq = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))];
  return uniq.map((p) => (proximity(p) > 0 ? `${quotePhrase(p)}~${proximity(p)}` : quotePhrase(p))).join(" OR ");
}

/**
 * Two-word personal names ("Gary Bornstein") also match records that include a middle
 * name or initial ("Gary Andrew Bornstein"). Such matches are classified as possible
 * identity matches downstream, never as exact.
 */
export function personProximity(entityType: string): (p: string) => number {
  if (entityType !== "person" && entityType !== "attorney") return () => 0;
  return (p: string) => (p.includes(",") ? 0 : p.trim().split(/\s+/).length === 2 ? 1 : 0);
}

const ORDER: Record<ClSearchType, Record<SortOrder, string>> = {
  d: { relevance: "score desc", newest: "dateFiled desc", oldest: "dateFiled asc" },
  o: { relevance: "score desc", newest: "dateFiled desc", oldest: "dateFiled asc" },
  rd: { relevance: "score desc", newest: "entry_date_filed desc", oldest: "entry_date_filed asc" },
};

export interface CourtRestriction {
  /** CourtListener court ids to restrict to; `null` = no restriction; `[]` = nothing searchable. */
  courts: string[] | null;
}

function statusClause(filters: SearchFilters): string | null {
  const clauses: string[] = [];
  if (filters.status === "closed") clauses.push("dateTerminated:[* TO *]");
  if (filters.status === "active") clauses.push("-dateTerminated:[* TO *]");
  if (filters.terminatedAfter || filters.terminatedBefore) {
    clauses.push(`dateTerminated:[${filters.terminatedAfter ?? "*"} TO ${filters.terminatedBefore ?? "*"}]`);
  }
  return clauses.length ? clauses.join(" AND ") : null;
}

function withClause(base: string, clause: string | null): string {
  if (!base) return clause ?? "";
  if (!clause) return base;
  return `(${base}) AND ${clause}`;
}

function common(params: URLSearchParams, type: ClSearchType, q: EntityQuery, restriction: CourtRestriction) {
  params.set("type", type);
  params.set("order_by", ORDER[type][q.sort]);
  if (q.filters.filedAfter) params.set("filed_after", q.filters.filedAfter);
  if (q.filters.filedBefore) params.set("filed_before", q.filters.filedBefore);
  if (restriction.courts && restriction.courts.length) params.set("court", restriction.courts.join(" "));
}

export function buildDocketSearch(q: EntityQuery, restriction: CourtRestriction): URLSearchParams | null {
  if (restriction.courts && restriction.courts.length === 0) return null;
  const p = new URLSearchParams();
  const phrases = q.variants.map((v) => v.text);
  let base = "";
  switch (q.entityType) {
    case "docket_number":
      if (!q.docketNumber) return null;
      p.set("docket_number", q.docketNumber);
      break;
    case "case":
      p.set("case_name", q.raw);
      break;
    case "attorney":
      base = `attorney:(${orPhrases(phrases, personProximity(q.entityType))})`;
      break;
    case "law_firm":
      base = `firm:(${orPhrases(phrases)}) OR party:(${orPhrases(phrases)})`;
      break;
    default:
      base = `party:(${orPhrases(phrases, personProximity(q.entityType))}) OR caseName:(${orPhrases(phrases, personProximity(q.entityType))})`;
  }
  const q2 = withClause(base, statusClause(q.filters));
  if (q2) p.set("q", q2);
  common(p, "d", q, restriction);
  return p;
}

export function buildOpinionSearch(q: EntityQuery, restriction: CourtRestriction): URLSearchParams | null {
  if (restriction.courts && restriction.courts.length === 0) return null;
  const p = new URLSearchParams();
  const phrases = q.variants.map((v) => v.text);
  switch (q.entityType) {
    case "docket_number":
      if (!q.docketNumber) return null;
      p.set("docket_number", q.docketNumber);
      break;
    case "case":
      p.set("case_name", q.raw);
      break;
    case "attorney":
      p.set("q", `attorney:(${orPhrases(phrases, personProximity(q.entityType))})`);
      break;
    default:
      p.set("q", orPhrases(phrases, personProximity(q.entityType)));
      p.set("highlight", "on");
  }
  // Include unpublished decisions too; the default is published only.
  p.set("stat_Published", "on");
  p.set("stat_Unpublished", "on");
  common(p, "o", q, restriction);
  return p;
}

export function buildDocumentSearch(q: EntityQuery, restriction: CourtRestriction): URLSearchParams | null {
  if (restriction.courts && restriction.courts.length === 0) return null;
  if (!["person", "company", "law_firm", "unknown"].includes(q.entityType)) return null;
  const p = new URLSearchParams();
  p.set("q", orPhrases(q.variants.map((v) => v.text), personProximity(q.entityType)));
  p.set("highlight", "on");
  common(p, "rd", q, restriction);
  return p;
}

export function buildDocketIdLookup(ids: string[]): URLSearchParams | null {
  const clean = [...new Set(ids.filter((i) => /^\d+$/.test(i)))].slice(0, 20);
  if (!clean.length) return null;
  const p = new URLSearchParams();
  p.set("type", "d");
  p.set("q", `docket_id:(${clean.join(" OR ")})`);
  return p;
}

/** Extracts the opaque cursor from a CourtListener `next` URL. Only the cursor is kept. */
export function cursorFromNext(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    return new URL(next).searchParams.get("cursor");
  } catch {
    return null;
  }
}
