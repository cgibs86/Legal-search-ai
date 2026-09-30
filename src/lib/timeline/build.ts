import type { DocketEntry, SearchHit } from "@/lib/domain/types";

/**
 * ENTITY TIMELINE — chronological events derived only from dated fields in the records:
 * filing dates, termination dates, decision dates, filing/mention dates and (for loaded
 * dockets) docket entries. Undated items are listed separately, never placed on a guess.
 */

export type TimelineEventKind = "case_filed" | "case_terminated" | "decision" | "filing" | "order" | "judgment" | "hearing" | "appeal" | "docket_entry" | "mention";

export interface TimelineEvent {
  id: string;
  date: string;
  kind: TimelineEventKind;
  title: string;
  detail: string | null;
  recordKey: string;
  caseName: string;
  court: string;
  url: string | null;
}

export interface Timeline {
  events: TimelineEvent[];
  undated: { recordKey: string; caseName: string }[];
  range: { from: string | null; to: string | null };
}

export function buildEntityTimeline(hits: SearchHit[]): Timeline {
  const events: TimelineEvent[] = [];
  const undated: Timeline["undated"] = [];
  for (const h of hits) {
    const r = h.record;
    const court = r.court.citation ?? r.court.name;
    const url = r.sources[0]?.url ?? null;
    let dated = false;
    if (r.dateFiled) {
      events.push({ id: `${r.key}:filed`, date: r.dateFiled, kind: "case_filed", title: "Case filed", detail: r.natureOfSuit, recordKey: r.key, caseName: r.caseName, court, url });
      dated = true;
    }
    if (r.dateTerminated) {
      events.push({ id: `${r.key}:term`, date: r.dateTerminated, kind: "case_terminated", title: "Case terminated", detail: null, recordKey: r.key, caseName: r.caseName, court, url });
      dated = true;
    }
    for (const o of r.opinions) {
      if (!o.dateFiled) continue;
      events.push({
        id: `${r.key}:op:${o.id}`,
        date: o.dateFiled,
        kind: r.court.type === "appellate" || r.court.type === "supreme" ? "appeal" : "decision",
        title: r.court.type === "appellate" || r.court.type === "supreme" ? "Appellate decision" : "Decision",
        detail: [o.citations[0], o.status].filter(Boolean).join(" · ") || null,
        recordKey: r.key,
        caseName: r.caseName,
        court,
        url: o.url,
      });
      dated = true;
    }
    for (const d of [...r.documents, ...h.match.mentions.filter((m) => m.kind !== "opinion")]) {
      if (!d.date) continue;
      events.push({
        id: `${r.key}:doc:${d.id}`,
        date: d.date,
        kind: h.match.types.includes("mention") && !h.match.types.includes("party") ? "mention" : "filing",
        title: h.match.types.includes("mention") && !h.match.types.includes("party") ? "Named in a filing" : "Filing",
        detail: d.title,
        recordKey: r.key,
        caseName: r.caseName,
        court,
        url: d.url,
      });
      dated = true;
    }
    if (!dated) undated.push({ recordKey: r.key, caseName: r.caseName });
  }
  const uniq = new Map(events.map((e) => [e.id, e]));
  const sorted = [...uniq.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { events: sorted, undated, range: { from: sorted[0]?.date ?? null, to: sorted.at(-1)?.date ?? null } };
}

const ENTRY_KIND: Partial<Record<DocketEntry["category"], TimelineEventKind>> = {
  order: "order",
  judgment: "judgment",
  hearing: "hearing",
  appeal: "appeal",
  complaint: "case_filed",
};

export function docketEntriesToEvents(recordKey: string, caseName: string, court: string, entries: DocketEntry[]): TimelineEvent[] {
  return entries
    .filter((e) => e.dateFiled)
    .map((e) => ({
      id: `${recordKey}:entry:${e.id}`,
      date: e.dateFiled!,
      kind: ENTRY_KIND[e.category] ?? "docket_entry",
      title: `${e.entryNumber ? `#${e.entryNumber} ` : ""}${e.category === "other" ? "Docket entry" : e.category[0].toUpperCase() + e.category.slice(1)}`,
      detail: e.description.slice(0, 220),
      recordKey,
      caseName,
      court,
      url: e.documents[0]?.url ?? null,
    }));
}
