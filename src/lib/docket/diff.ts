import type { DocketDetail, DocketEntry } from "@/lib/domain/types";

/**
 * DOCKET DIFF — compares the current docket against the last stored snapshot and reports
 * only what changed. Snapshots store entry ids and a few metadata fields, not documents.
 */

export interface DocketSnapshot {
  capturedAt: string;
  caseName: string;
  status: string;
  dateTerminated: string | null;
  judge: string | null;
  dateLastFiling: string | null;
  entryIds: string[];
  /** Latest entry date covered by this snapshot (entries are paged newest-first). */
  newestEntryDate: string | null;
  partyNames: string[];
}

export interface DiffChange {
  kind: "new_filing" | "new_order" | "new_hearing" | "new_deadline" | "new_document" | "status_change" | "case_closed" | "judge_change" | "party_change" | "other";
  title: string;
  detail: string;
  date: string | null;
  entryId: string | null;
  url: string | null;
}

export interface DocketDiffResult {
  hasChanges: boolean;
  since: string;
  changes: DiffChange[];
  counts: Record<DiffChange["kind"], number>;
  newSnapshot: DocketSnapshot;
}

export function snapshotOf(detail: DocketDetail, now = new Date()): DocketSnapshot {
  const r = detail.record;
  const dates = detail.entries.map((e) => e.dateFiled).filter(Boolean) as string[];
  return {
    capturedAt: now.toISOString(),
    caseName: r.caseName,
    status: r.status,
    dateTerminated: r.dateTerminated,
    judge: r.judge,
    dateLastFiling: detail.dateLastFiling,
    entryIds: detail.entries.map((e) => e.id),
    newestEntryDate: dates.sort().at(-1) ?? null,
    partyNames: r.parties.map((p) => p.name).sort(),
  };
}

function kindForEntry(e: DocketEntry): DiffChange["kind"] {
  if (e.category === "order" || e.category === "judgment") return "new_order";
  if (e.category === "hearing") return "new_hearing";
  return "new_filing";
}

export function diffDocket(previous: DocketSnapshot | null, current: DocketDetail, now = new Date()): DocketDiffResult {
  const next = snapshotOf(current, now);
  const counts = { new_filing: 0, new_order: 0, new_hearing: 0, new_deadline: 0, new_document: 0, status_change: 0, case_closed: 0, judge_change: 0, party_change: 0, other: 0 } as DocketDiffResult["counts"];
  if (!previous) {
    // First check establishes the baseline; nothing is "new since last check" yet.
    return { hasChanges: false, since: now.toISOString(), changes: [], counts, newSnapshot: next };
  }
  const changes: DiffChange[] = [];
  const known = new Set(previous.entryIds);
  const newEntries = current.entries.filter((e) => !known.has(e.id) && (!previous.newestEntryDate || !e.dateFiled || e.dateFiled >= previous.newestEntryDate));
  for (const e of newEntries) {
    const kind = kindForEntry(e);
    changes.push({ kind, title: `${e.entryNumber ? `#${e.entryNumber} · ` : ""}${e.description.slice(0, 120)}`, detail: e.description, date: e.dateFiled, entryId: e.id, url: e.documents[0]?.url ?? null });
    for (const d of e.deadlines) changes.push({ kind: "new_deadline", title: `Deadline ${d.date}`, detail: d.text, date: d.date, entryId: e.id, url: null });
    const available = e.documents.filter((d) => d.available);
    if (available.length) changes.push({ kind: "new_document", title: `${available.length} document${available.length > 1 ? "s" : ""} available`, detail: available.map((d) => d.title).join("; "), date: e.dateFiled, entryId: e.id, url: available[0].url });
  }
  if (!previous.dateTerminated && current.record.dateTerminated) {
    changes.push({ kind: "case_closed", title: "Case terminated", detail: `Termination date recorded: ${current.record.dateTerminated}`, date: current.record.dateTerminated, entryId: null, url: current.record.sources[0]?.url ?? null });
  } else if (previous.status !== current.record.status) {
    changes.push({ kind: "status_change", title: `Status changed: ${previous.status} → ${current.record.status}`, detail: current.record.statusBasis, date: null, entryId: null, url: null });
  }
  if (previous.judge && current.record.judge && previous.judge !== current.record.judge) {
    changes.push({ kind: "judge_change", title: "Assigned judge changed", detail: `${previous.judge} → ${current.record.judge}`, date: null, entryId: null, url: null });
  }
  const prevParties = new Set(previous.partyNames);
  const added = next.partyNames.filter((p) => !prevParties.has(p));
  if (previous.partyNames.length && added.length) {
    changes.push({ kind: "party_change", title: `${added.length} new part${added.length > 1 ? "ies" : "y"}`, detail: added.slice(0, 8).join("; "), date: null, entryId: null, url: null });
  }
  for (const c of changes) counts[c.kind] += 1;
  // Retain previously known ids so paging windows don't re-report old entries.
  next.entryIds = [...new Set([...previous.entryIds, ...next.entryIds])].slice(-2000);
  return { hasChanges: changes.length > 0, since: previous.capturedAt, changes, counts, newSnapshot: next };
}
