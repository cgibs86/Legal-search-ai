import type { DocketEntry, SearchHit } from "@/lib/domain/types";

/**
 * Exports contain this app's normalized metadata plus source links and attribution.
 * They never include document text (which may carry provider terms).
 */

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // defuse spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n");
}

export function hitsToRows(hits: SearchHit[]) {
  return hits.map((h) => ({
    case_name: h.record.caseName,
    court: h.record.court.name,
    jurisdiction: h.record.court.level,
    state: h.record.court.state ?? "",
    docket_number: h.record.docketNumber ?? "",
    date_filed: h.record.dateFiled ?? "",
    date_terminated: h.record.dateTerminated ?? "",
    status: h.record.status,
    case_type: h.record.category,
    nature_of_suit: h.record.natureOfSuit ?? "",
    judge: h.record.judge ?? "",
    match_types: h.match.types.join("; "),
    matched_name: h.match.matchedText,
    party_role: h.match.partyRole ?? "",
    why_matched: h.match.reasons.join(" | "),
    identity_note: h.match.identityNote ?? "",
    sources: h.record.sources.map((s) => `${s.label}${s.live ? "" : " (demo snapshot)"}: ${s.url ?? "n/a"}`).join(" | "),
  }));
}

export function entriesToRows(caseName: string, entries: DocketEntry[], sourceUrl: string | null) {
  return entries.map((e) => ({
    case_name: caseName,
    entry_number: e.entryNumber ?? "",
    date_filed: e.dateFiled ?? "",
    category: e.category,
    description: e.description,
    deadlines: e.deadlines.map((d) => `${d.date}: ${d.text}`).join(" | "),
    documents: e.documents.map((d) => `${d.title} ${d.url ?? ""}`).join(" | "),
    source: sourceUrl ?? "",
  }));
}

export const EXPORT_ATTRIBUTION =
  "Exported from Legal Search AI. Source data: CourtListener (Free Law Project) and other listed sources. Court records can contain people with identical names; a result does not establish identity. Filings contain allegations, not proven facts.";
