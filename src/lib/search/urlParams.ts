import type { CaseCategory, MatchType, RecordKind, SearchFilters } from "@/lib/domain/types";

const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : undefined);

/** Search filters <-> URL query params (shared by the search page, saved searches and alerts). */
export function filtersFromParams(p: URLSearchParams): SearchFilters {
  const f: SearchFilters = {
    matchTypes: csv(p.get("mt")) as MatchType[] | undefined,
    recordKinds: csv(p.get("rk")) as RecordKind[] | undefined,
    partyKind: (p.get("pk") as SearchFilters["partyKind"]) ?? undefined,
    jurisdiction: (p.get("j") as SearchFilters["jurisdiction"]) ?? undefined,
    states: csv(p.get("st")),
    courts: csv(p.get("ct")),
    categories: csv(p.get("cat")) as CaseCategory[] | undefined,
    status: (p.get("s") as SearchFilters["status"]) ?? undefined,
    filedAfter: p.get("fa") ?? undefined,
    filedBefore: p.get("fb") ?? undefined,
    terminatedAfter: p.get("ta") ?? undefined,
    terminatedBefore: p.get("tb") ?? undefined,
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")) as SearchFilters;
}

export function filtersToParams(f: SearchFilters, p: URLSearchParams) {
  const map: [keyof SearchFilters, string][] = [["matchTypes", "mt"], ["recordKinds", "rk"], ["partyKind", "pk"], ["jurisdiction", "j"], ["states", "st"], ["courts", "ct"], ["categories", "cat"], ["status", "s"], ["filedAfter", "fa"], ["filedBefore", "fb"], ["terminatedAfter", "ta"], ["terminatedBefore", "tb"]];
  for (const [k, param] of map) {
    const v = f[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) p.delete(param);
    else p.set(param, Array.isArray(v) ? v.join(",") : String(v));
  }
}

/** URL for a search page with the given query, entity type and filters. */
export function searchHref(query: string, entityType?: string | null, filters?: SearchFilters): string {
  const p = new URLSearchParams({ q: query });
  if (entityType && entityType !== "unknown") p.set("type", entityType);
  if (filters) filtersToParams(filters, p);
  return `/search?${p.toString()}`;
}
