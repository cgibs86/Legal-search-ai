import { createHash } from "node:crypto";
import type { DocketDetail } from "@/lib/domain/types";
import type { CaseDetail, DocumentText } from "@/lib/providers/types";

/**
 * Source packaging for the AI Case Brief. The model sees only these numbered sources;
 * every statement it writes must cite them, and the server re-checks the citations.
 */

export interface BriefSource {
  id: string;
  label: string;
  kind: "docket_metadata" | "docket_entry" | "opinion" | "document";
  date: string | null;
  url: string | null;
  text: string;
}

const MAX_ENTRY_SOURCES = 30;

export function sourcesFromDocket(detail: DocketDetail, extraDocs: DocumentText[] = []): BriefSource[] {
  const r = detail.record;
  const docketUrl = r.sources[0]?.url ?? null;
  const parties = r.parties.map((p) => `${p.name}${p.role ? ` (${p.role})` : p.roleSource === "caption" ? " (named in caption)" : ""}`).join("; ");
  const meta = [
    `Case name: ${r.caseName}`,
    `Court: ${r.court.name}`,
    r.docketNumber ? `Docket number: ${r.docketNumber}` : null,
    r.dateFiled ? `Date filed: ${r.dateFiled}` : null,
    r.dateTerminated ? `Date terminated: ${r.dateTerminated}` : "Date terminated: none recorded",
    detail.dateLastFiling ? `Date of last filing: ${detail.dateLastFiling}` : null,
    r.judge ? `Assigned judge: ${r.judge}` : null,
    r.natureOfSuit ? `Nature of suit: ${r.natureOfSuit}` : null,
    r.cause ? `Cause: ${r.cause}` : null,
    parties ? `Parties: ${parties}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const out: BriefSource[] = [{ id: "S1", label: "Docket metadata", kind: "docket_metadata", date: r.dateFiled, url: docketUrl, text: meta }];

  const important = detail.entries.filter((e) => e.important);
  const recent = detail.entries.slice(0, MAX_ENTRY_SOURCES);
  const chosen = [...new Map([...important, ...recent].map((e) => [e.id, e])).values()].slice(0, MAX_ENTRY_SOURCES);
  chosen.sort((a, b) => (a.dateFiled ?? "").localeCompare(b.dateFiled ?? ""));
  for (const e of chosen) {
    out.push({
      id: `S${out.length + 1}`,
      label: `Docket entry${e.entryNumber ? ` #${e.entryNumber}` : ""}${e.dateFiled ? ` (${e.dateFiled})` : ""}`,
      kind: "docket_entry",
      date: e.dateFiled,
      url: e.documents[0]?.url ?? docketUrl,
      text: e.description.slice(0, 1200),
    });
  }
  for (const d of extraDocs) {
    out.push({ id: `S${out.length + 1}`, label: `Document: ${d.title}`.slice(0, 160), kind: "document", date: null, url: d.url, text: d.text.slice(0, 12_000) });
  }
  return out;
}

export function sourcesFromCase(detail: CaseDetail): BriefSource[] {
  const r = detail.record;
  const o = r.opinions[0];
  const meta = [
    `Case name: ${r.caseName}`,
    `Court: ${r.court.name}`,
    r.docketNumber ? `Docket number: ${r.docketNumber}` : null,
    o?.dateFiled ? `Decision date: ${o.dateFiled}` : null,
    r.judge ? `Judges: ${r.judge}` : null,
    r.citations.length ? `Citations: ${r.citations.join("; ")}` : null,
    o?.status ? `Precedential status: ${o.status}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const out: BriefSource[] = [{ id: "S1", label: "Decision metadata", kind: "docket_metadata", date: o?.dateFiled ?? null, url: o?.url ?? null, text: meta }];
  if (detail.opinionText) {
    // Split long opinions into citeable chunks so statements can point to a specific part.
    const text = detail.opinionText.text;
    const size = 6000;
    for (let i = 0; i < Math.min(text.length, 36_000); i += size) {
      out.push({ id: `S${out.length + 1}`, label: `Opinion text, part ${i / size + 1}`, kind: "opinion", date: o?.dateFiled ?? null, url: detail.opinionText.url, text: text.slice(i, i + size) });
    }
  }
  return out;
}

export function fingerprint(sources: BriefSource[]): string {
  const h = createHash("sha256");
  for (const s of sources) h.update(`${s.id}|${s.label}|${s.text}\n`);
  return h.digest("hex").slice(0, 24);
}
