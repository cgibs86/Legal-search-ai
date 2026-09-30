import "server-only";
import raw from "./courts.json";
import type { CourtRef, CourtType, JurisdictionLevel } from "@/lib/domain/types";

/**
 * CourtListener's jurisdiction table (3,359 courts), fetched from
 * https://www.courtlistener.com/help/api/jurisdictions/ on 2026-09-30.
 * `n` is the number of indexed decisions CourtListener reported for the court on that date.
 */
interface RawCourt {
  id: string;
  name: string;
  cite: string | null;
  j: string;
  st: string | null;
  start: string | null;
  end: string | null;
  inUse: boolean;
  n: number | null;
}

export const COURTS_SNAPSHOT_DATE = "2026-09-30";

const COURTS = raw as RawCourt[];
const BY_ID = new Map(COURTS.map((c) => [c.id, c]));

const LEVEL: Record<string, JurisdictionLevel> = {
  F: "federal",
  FD: "federal",
  FB: "federal",
  FBP: "federal",
  FS: "federal",
  S: "state",
  SA: "state",
  ST: "state",
  SS: "state",
  SAG: "state",
  TRS: "tribal",
  TRA: "tribal",
  TRT: "tribal",
  TRX: "tribal",
  TS: "territorial",
  TA: "territorial",
  TT: "territorial",
  TSP: "territorial",
  MA: "military",
  MT: "military",
};

const TYPE: Record<string, CourtType> = {
  F: "appellate",
  FD: "trial",
  FB: "bankruptcy",
  FBP: "bankruptcy",
  FS: "special",
  S: "supreme",
  SA: "appellate",
  ST: "trial",
  SS: "special",
  SAG: "special",
  TRS: "supreme",
  TRA: "appellate",
  TRT: "trial",
  TRX: "special",
  TS: "supreme",
  TA: "appellate",
  TT: "trial",
  TSP: "special",
  MA: "appellate",
  MT: "trial",
};

/** Federal circuits and the states whose district courts they hear appeals from. */
export const CIRCUIT_STATES: Record<string, string[]> = {
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

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", MP: "Northern Mariana Islands", AS: "American Samoa",
};

function toRef(c: RawCourt): CourtRef {
  return {
    id: c.id,
    name: c.name,
    citation: c.cite,
    level: LEVEL[c.j] ?? "other",
    type: TYPE[c.j] ?? "other",
    state: c.st,
    jurisdictionCode: c.j,
  };
}

export function getCourt(id: string | null | undefined, fallbackName?: string | null, fallbackCite?: string | null): CourtRef {
  const c = id ? BY_ID.get(id) : undefined;
  if (c) return toRef(c);
  return {
    id: id ?? "unknown",
    name: fallbackName ?? "Unknown court",
    citation: fallbackCite ?? null,
    level: "other",
    type: "other",
    state: null,
    jurisdictionCode: null,
  };
}

export function isKnownCourt(id: string): boolean {
  return BY_ID.has(id);
}

export interface CourtQuery {
  levels?: JurisdictionLevel[];
  states?: string[];
  codes?: string[];
  inUseOnly?: boolean;
}

export function findCourts(q: CourtQuery = {}): CourtRef[] {
  return COURTS.filter((c) => {
    if (q.inUseOnly && !c.inUse) return false;
    const ref = toRef(c);
    if (q.levels && !q.levels.includes(ref.level)) return false;
    if (q.codes && !q.codes.includes(c.j)) return false;
    if (q.states && q.states.length) {
      if (ref.level === "federal" && c.j === "F") {
        const circuitStates = CIRCUIT_STATES[c.id];
        if (!circuitStates || !circuitStates.some((s) => q.states!.includes(s))) return false;
      } else if (!c.st || !q.states.includes(c.st)) return false;
    }
    return true;
  }).map(toRef);
}

export interface CourtCoverageStats {
  code: string;
  label: string;
  courts: number;
  courtsWithRecords: number;
  decisions: number;
}

const CODE_LABELS: Record<string, string> = {
  F: "Federal appellate (incl. Supreme Court)",
  FD: "Federal district",
  FB: "Federal bankruptcy",
  FBP: "Federal bankruptcy appellate panels",
  FS: "Federal special courts",
  S: "State supreme courts",
  SA: "State intermediate appellate courts",
  ST: "State trial courts",
  SS: "State special courts",
  SAG: "State attorneys general (opinions)",
  TRS: "Tribal supreme courts",
  TRA: "Tribal appellate courts",
  TRT: "Tribal trial courts",
  TS: "Territorial supreme courts",
  TA: "Territorial appellate courts",
  TT: "Territorial trial courts",
  MA: "Military appellate courts",
};

export function coverageStats(): CourtCoverageStats[] {
  const map = new Map<string, CourtCoverageStats>();
  for (const c of COURTS) {
    const label = CODE_LABELS[c.j];
    if (!label) continue;
    const s = map.get(c.j) ?? { code: c.j, label, courts: 0, courtsWithRecords: 0, decisions: 0 };
    s.courts += 1;
    if ((c.n ?? 0) > 0) s.courtsWithRecords += 1;
    s.decisions += c.n ?? 0;
    map.set(c.j, s);
  }
  return [...map.values()].sort((a, b) => b.decisions - a.decisions);
}

export function courtStartDate(id: string): string | null {
  return BY_ID.get(id)?.start ?? null;
}
