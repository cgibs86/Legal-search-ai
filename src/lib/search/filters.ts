import type { SearchFilters, SearchHit, SortOrder } from "@/lib/domain/types";

/** Circuit -> states (duplicated from the server-only courts module so this stays client-safe). */
const CIRCUIT_STATES: Record<string, string[]> = {
  ca1: ["ME", "MA", "NH", "RI", "PR"],
  ca2: ["CT", "NY", "VT"],
  ca3: ["DE", "NJ", "PA", "VI"],
  ca4: ["MD", "NC", "SC", "VA", "WV"],
  ca5: ["LA", "MS", "TX"],
  ca6: ["KY", "MI", "OH", "TN"],
  ca7: ["IL", "IN", "WI"],
  ca8: ["AR", "IA", "MN", "MO", "NE", "ND", "SD"],
  ca9: ["AK", "AZ", "CA", "HI", "ID", "MT", "NV", "OR", "WA", "GU", "MP"],
  ca10: ["CO", "KS", "NM", "OK", "UT", "WY"],
  ca11: ["AL", "FL", "GA"],
  cadc: ["DC"],
};

export function hitStates(h: SearchHit): string[] {
  if (h.record.court.state) return [h.record.court.state];
  return CIRCUIT_STATES[h.record.court.id] ?? [];
}

function primaryDate(h: SearchHit): string | null {
  return h.record.dateFiled ?? h.record.opinions[0]?.dateFiled ?? h.record.lastActivity ?? h.record.documents[0]?.date ?? null;
}

function inRange(d: string | null, after?: string, before?: string): boolean {
  if (!after && !before) return true;
  if (!d) return false;
  if (after && d < after) return false;
  if (before && d > before) return false;
  return true;
}

/**
 * Applies filters to retrieved, normalized hits. Some filters are also pushed to the
 * provider (courts, dates, status); this pass guarantees correctness for all of them.
 */
export function applyFilters(hits: SearchHit[], f: SearchFilters): SearchHit[] {
  return hits.filter((h) => {
    const r = h.record;
    if (f.matchTypes?.length && !h.match.types.some((t) => f.matchTypes!.includes(t))) return false;
    if (f.recordKinds?.length && !r.kinds.some((k) => f.recordKinds!.includes(k))) return false;
    if (f.jurisdiction && r.court.level !== f.jurisdiction) return false;
    if (f.courts?.length && !f.courts.includes(r.court.id)) return false;
    if (f.states?.length && !hitStates(h).some((s) => f.states!.includes(s))) return false;
    if (f.categories?.length && !f.categories.includes(r.category)) return false;
    if (f.status && r.status !== f.status) return false;
    if (!inRange(primaryDate(h), f.filedAfter, f.filedBefore)) return false;
    if ((f.terminatedAfter || f.terminatedBefore) && !inRange(r.dateTerminated, f.terminatedAfter, f.terminatedBefore)) return false;
    if (f.partyKind) {
      const matched = r.parties.find((p) => p.name === h.match.matchedText);
      if (matched) {
        if (f.partyKind === "company" && !matched.isOrganization) return false;
        if (f.partyKind === "individual" && matched.isOrganization) return false;
      }
    }
    return true;
  });
}

export function sortHits(hits: SearchHit[], sort: SortOrder): SearchHit[] {
  const copy = [...hits];
  if (sort === "relevance") return copy.sort((a, b) => b.score - a.score);
  const dir = sort === "newest" ? -1 : 1;
  return copy.sort((a, b) => {
    const da = primaryDate(a);
    const db = primaryDate(b);
    if (!da && !db) return b.score - a.score;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -dir : da > db ? dir : b.score - a.score;
  });
}

export function describeFilters(f: SearchFilters): string[] {
  const out: string[] = [];
  if (f.matchTypes?.length) out.push(`Match type: ${f.matchTypes.join(", ")}`);
  if (f.recordKinds?.length) out.push(`Record type: ${f.recordKinds.join(", ")}`);
  if (f.partyKind) out.push(`Party kind: ${f.partyKind}`);
  if (f.jurisdiction) out.push(`Jurisdiction: ${f.jurisdiction}`);
  if (f.states?.length) out.push(`States: ${f.states.join(", ")}`);
  if (f.courts?.length) out.push(`Courts: ${f.courts.join(", ")}`);
  if (f.categories?.length) out.push(`Case type: ${f.categories.join(", ")}`);
  if (f.status) out.push(`Status: ${f.status}`);
  if (f.filedAfter || f.filedBefore) out.push(`Filed: ${f.filedAfter ?? "any"} – ${f.filedBefore ?? "any"}`);
  if (f.terminatedAfter || f.terminatedBefore) out.push(`Terminated: ${f.terminatedAfter ?? "any"} – ${f.terminatedBefore ?? "any"}`);
  return out;
}

export { primaryDate };
