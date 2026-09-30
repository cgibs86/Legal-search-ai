import type { JurisdictionLevel, MatchType, RecordKind, ResultSummary, SearchHit } from "@/lib/domain/types";
import type { SourceResult } from "@/lib/providers/types";
import { hitStates, primaryDate } from "./filters";

export function summarize(hits: SearchHit[], sources: SourceResult[]): ResultSummary {
  const byMatchType: Record<MatchType, number> = { party: 0, mention: 0, docket: 0, attorney: 0, possible_identity: 0 };
  const byKind: Record<RecordKind, number> = { docket: 0, opinion: 0, filing: 0 };
  const levels = new Map<JurisdictionLevel, number>();
  const states = new Map<string, number>();
  const courts = new Map<string, { id: string; name: string; count: number }>();
  const dates: string[] = [];
  for (const h of hits) {
    for (const t of h.match.types) byMatchType[t] += 1;
    for (const k of h.record.kinds) byKind[k] += 1;
    levels.set(h.record.court.level, (levels.get(h.record.court.level) ?? 0) + 1);
    for (const s of hitStates(h)) states.set(s, (states.get(s) ?? 0) + 1);
    const c = courts.get(h.record.court.id) ?? { id: h.record.court.id, name: h.record.court.citation ?? h.record.court.name, count: 0 };
    c.count += 1;
    courts.set(h.record.court.id, c);
    const d = primaryDate(h);
    if (d) dates.push(d);
  }
  dates.sort();
  const providerTotals = sources
    .filter((s) => s.totalCount != null)
    .map((s) => ({ source: s.label, count: s.totalCount!, approximate: s.countIsApproximate }));
  const moreAvailable = sources.some((s) => (s.totalCount ?? 0) > s.hits.length);
  return {
    total: hits.length,
    totalIsApproximate: moreAvailable,
    byMatchType,
    byKind,
    jurisdictions: [...levels.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => b.count - a.count),
    states: [...states.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
    courts: [...courts.values()].sort((a, b) => b.count - a.count),
    dateRange: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    providerTotals,
  };
}
