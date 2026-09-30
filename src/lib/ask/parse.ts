import type { CaseCategory, CaseStatus, MatchType, SearchHit } from "@/lib/domain/types";
import { hitStates, primaryDate } from "@/lib/search/filters";

/**
 * SEARCH WITHIN RESULTS
 *
 * Questions are translated into a structured filter over the already-retrieved records.
 * The answer is always the set of matching records plus a sentence built from counts —
 * never free-form model knowledge.
 */

export interface AskSpec {
  status?: CaseStatus;
  states?: string[];
  filedAfter?: string;
  filedBefore?: string;
  categories?: CaseCategory[];
  matchTypes?: MatchType[];
  role?: "plaintiff" | "defendant" | "petitioner" | "respondent" | "debtor" | "creditor" | "appellant" | "appellee";
  courtText?: string;
  groupBy?: "attorney" | "firm" | "court" | "judge";
}

export interface AskAnswer {
  interpretation: string[];
  matchingIds: string[];
  groups: { label: string; ids: string[] }[];
  answer: string;
  notes: string[];
  understood: boolean;
  usedAI: boolean;
}

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

export function parseQuestion(q: string): { spec: AskSpec; understood: boolean } {
  const s = ` ${q.toLowerCase().replace(/[?.!,]/g, " ")} `;
  const spec: AskSpec = {};
  if (/\b(active|open|pending|ongoing|still)\b/.test(s)) spec.status = "active";
  if (/\b(closed|terminated|ended|resolved|dismissed)\b/.test(s)) spec.status = "closed";
  const states = Object.entries(STATES)
    .filter(([name]) => new RegExp(`\\b${name}\\b`).test(s) && !(name === "virginia" && /west virginia/.test(s)) && !(name === "kansas" && /arkansas/.test(s)))
    .map(([, abbr]) => abbr);
  if (states.length) spec.states = states;
  const after = s.match(/\b(after|since|from)\s+(\d{4})\b/);
  if (after) spec.filedAfter = after[1] === "after" ? `${Number(after[2]) + 1}-01-01` : `${after[2]}-01-01`;
  const before = s.match(/\b(before|prior to|until)\s+(\d{4})\b/);
  if (before) spec.filedBefore = before[1] === "until" ? `${before[2]}-12-31` : `${Number(before[2]) - 1}-12-31`;
  const inYear = s.match(/\bin\s+(\d{4})\b/);
  if (inYear && !after && !before) {
    spec.filedAfter = `${inYear[1]}-01-01`;
    spec.filedBefore = `${inYear[1]}-12-31`;
  }
  const cats: CaseCategory[] = [];
  if (/\bbankrupt/.test(s)) cats.push("bankruptcy");
  if (/\bcriminal\b/.test(s)) cats.push("criminal");
  if (/\bcivil\b/.test(s)) cats.push("civil");
  if (/\b(appeal|appellate)\b/.test(s)) cats.push("appeal");
  if (cats.length) spec.categories = cats;
  for (const role of ["plaintiff", "defendant", "petitioner", "respondent", "debtor", "creditor", "appellant", "appellee"] as const) {
    if (new RegExp(`\\b${role}s?\\b`).test(s)) spec.role = role;
  }
  if (/\bmention/.test(s)) spec.matchTypes = ["mention"];
  if (/\bas (a )?party\b|\bparty to\b/.test(s)) spec.matchTypes = ["party"];
  if (/\bsame (attorney|lawyer|counsel)\b|\bwhich attorney|\bby attorney/.test(s)) spec.groupBy = "attorney";
  else if (/\bsame (law )?firm\b|\bwhich firm/.test(s)) spec.groupBy = "firm";
  else if (/\bsame judge\b|\bby judge|\bwhich judge/.test(s)) spec.groupBy = "judge";
  else if (/\bby court\b|\bwhich court/.test(s)) spec.groupBy = "court";
  const courtMatch = s.match(/\b(ninth|second|third|fourth|fifth|sixth|seventh|eighth|tenth|eleventh|first|d\.?c\.?) circuit\b|\b([nsewcm]\.?d\.?\s?[a-z]{2,5}\.?)\b/);
  if (courtMatch) spec.courtText = courtMatch[0].trim();
  const understood = Object.keys(spec).length > 0;
  return { spec, understood };
}

function roleMatches(h: SearchHit, role: NonNullable<AskSpec["role"]>): boolean | null {
  const r = h.match.partyRole?.toLowerCase();
  if (!r) return null;
  if (r.includes("caption")) return null;
  return r.includes(role);
}

const CIRCUIT_WORDS: Record<string, string> = { first: "ca1", second: "ca2", third: "ca3", fourth: "ca4", fifth: "ca5", sixth: "ca6", seventh: "ca7", eighth: "ca8", ninth: "ca9", tenth: "ca10", eleventh: "ca11", "d.c.": "cadc", dc: "cadc" };

export function executeAsk(hits: SearchHit[], spec: AskSpec, usedAI = false): AskAnswer {
  const interpretation: string[] = [];
  const notes: string[] = [];
  let out = hits;
  if (spec.status) {
    out = out.filter((h) => h.record.status === spec.status);
    interpretation.push(spec.status === "active" ? "Status: open (no termination date recorded)" : "Status: terminated");
    const unknown = hits.filter((h) => h.record.status === "unknown").length;
    if (unknown) notes.push(`${unknown} result(s) have no status in the source (e.g. opinion-only records) and were excluded.`);
  }
  if (spec.states?.length) {
    out = out.filter((h) => hitStates(h).some((s) => spec.states!.includes(s)));
    interpretation.push(`Located in: ${spec.states.join(", ")}`);
  }
  if (spec.filedAfter || spec.filedBefore) {
    out = out.filter((h) => {
      const d = primaryDate(h);
      if (!d) return false;
      return (!spec.filedAfter || d >= spec.filedAfter) && (!spec.filedBefore || d <= spec.filedBefore);
    });
    interpretation.push(`Filed/decided ${spec.filedAfter ? `from ${spec.filedAfter}` : ""}${spec.filedAfter && spec.filedBefore ? " " : ""}${spec.filedBefore ? `through ${spec.filedBefore}` : ""}`);
  }
  if (spec.categories?.length) {
    out = out.filter((h) => spec.categories!.includes(h.record.category));
    interpretation.push(`Case type: ${spec.categories.join(", ")}`);
  }
  if (spec.matchTypes?.length) {
    out = out.filter((h) => h.match.types.some((t) => spec.matchTypes!.includes(t)));
    interpretation.push(`Match type: ${spec.matchTypes.join(", ")}`);
  }
  if (spec.courtText) {
    const t = spec.courtText.toLowerCase().replace(/\s+/g, "");
    const circuit = Object.entries(CIRCUIT_WORDS).find(([w]) => spec.courtText!.toLowerCase().startsWith(w))?.[1];
    out = out.filter((h) => (circuit ? h.record.court.id === circuit : `${h.record.court.citation ?? ""}${h.record.court.name}`.toLowerCase().replace(/\s+/g, "").includes(t)));
    interpretation.push(`Court: ${spec.courtText}`);
  }
  if (spec.role) {
    const unknownRole = out.filter((h) => roleMatches(h, spec.role!) === null).length;
    out = out.filter((h) => roleMatches(h, spec.role!) === true);
    interpretation.push(`Recorded party role: ${spec.role}`);
    if (unknownRole) notes.push(`${unknownRole} result(s) have no recorded party role (caption-only or party list not captured) and were excluded.`);
  }

  const groups: AskAnswer["groups"] = [];
  if (spec.groupBy) {
    const map = new Map<string, string[]>();
    for (const h of out) {
      const keys =
        spec.groupBy === "attorney" ? h.record.attorneys.map((a) => a.name) : spec.groupBy === "firm" ? h.record.firms : spec.groupBy === "judge" ? (h.record.judge ? [h.record.judge] : []) : [h.record.court.citation ?? h.record.court.name];
      for (const k of new Set(keys)) map.set(k, [...(map.get(k) ?? []), h.id]);
    }
    for (const [label, ids] of map) if (ids.length >= 2) groups.push({ label, ids });
    groups.sort((a, b) => b.ids.length - a.ids.length);
    interpretation.push(`Grouped by ${spec.groupBy} (appearing in 2+ matters)`);
    if (!groups.length) notes.push(`No ${spec.groupBy} appears in more than one of these matters.`);
  }

  const ids = spec.groupBy ? [...new Set(groups.flatMap((g) => g.ids))] : out.map((h) => h.id);
  const answer = spec.groupBy
    ? groups.length
      ? `${groups.length} ${spec.groupBy === "attorney" ? "attorney(s)" : spec.groupBy === "firm" ? "firm(s)" : spec.groupBy === "judge" ? "judge(s)" : "court(s)"} appear in more than one matter. Top: ${groups[0].label} (${groups[0].ids.length}).`
      : `No repeated ${spec.groupBy} among the matching records.`
    : `${ids.length} of ${hits.length} retrieved record(s) match.`;
  return { interpretation, matchingIds: ids, groups: groups.slice(0, 10), answer, notes, understood: interpretation.length > 0, usedAI };
}
