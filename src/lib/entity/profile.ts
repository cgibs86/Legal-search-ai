import type { CaseCategory, DocumentHit, EntityType, JurisdictionLevel, MatchType, NameVariant, RecordKind, SearchHit } from "@/lib/domain/types";
import { matchName } from "@/lib/search/match";
import { primaryDate } from "@/lib/search/filters";
import { firmKey, isPlaceholderParty, looksLikeLawFirm, looksLikeOrganization, normalizeName } from "@/lib/text/names";

/**
 * ENTITY PROFILE — an aggregation of the records retrieved for a name. Every figure is a
 * count over those records, with the record keys that produced it, so the UI can link
 * each number back to its sources. It describes what the records say, never who the
 * person or company "is": matching names do not establish identity.
 */

export interface Tally {
  key: string;
  label: string;
  count: number;
  recordKeys: string[];
}

export interface CourtTally extends Tally {
  level: JurisdictionLevel;
  state: string | null;
}

export interface CounterpartyTally extends Tally {
  isOrganization: boolean;
  /** How the relationship appears in the records: named on the other side of a caption, or co-listed. */
  relation: "opposite_caption" | "co_party" | "same_case";
}

export interface EntityProfile {
  query: string;
  entityType: EntityType;
  overview: {
    records: number;
    byMatchType: Record<MatchType, number>;
    byKind: Record<RecordKind, number>;
    firstSeen: string | null;
    lastSeen: string | null;
    status: { active: number; closed: number; unknown: number };
    categories: { category: CaseCategory; count: number }[];
    jurisdictions: { level: JurisdictionLevel; count: number }[];
    roles: { role: string; count: number }[];
    /** Records per calendar year (from each record's primary date). */
    byYear: { year: number; count: number }[];
  };
  courts: CourtTally[];
  counterparties: CounterpartyTally[];
  companies: CounterpartyTally[];
  attorneys: Tally[];
  firms: Tally[];
  judges: Tally[];
  documents: (DocumentHit & { recordKey: string; caseName: string })[];
}

const MATCH_TYPES: MatchType[] = ["party", "mention", "docket", "attorney", "possible_identity"];
const KINDS: RecordKind[] = ["docket", "opinion", "filing"];

function bump(map: Map<string, Tally>, key: string, label: string, recordKey: string) {
  const t = map.get(key) ?? { key, label, count: 0, recordKeys: [] };
  if (!t.recordKeys.includes(recordKey)) {
    t.count += 1;
    t.recordKeys.push(recordKey);
  }
  map.set(key, t);
}

function sorted<T extends Tally>(m: Map<string, T>, limit: number): T[] {
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Which caption side ("v." split) the entity is on, if it is named in the caption. */
function captionSideOf(caseName: string, variants: NameVariant[], type: EntityType): { mine: string[]; other: string[] } | null {
  const sides = caseName.split(/\s+v(?:s)?\.?\s+/i);
  if (sides.length !== 2) return null;
  const inA = sides[0].split(/,?\s+(?:and|&)\s+|;\s*/).some((p) => matchName(p.trim(), variants, type));
  const inB = sides[1].split(/,?\s+(?:and|&)\s+|;\s*/).some((p) => matchName(p.trim(), variants, type));
  if (inA === inB) return null;
  const split = (s: string) => s.split(/;\s*|,?\s+(?:and|&)\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
  return inA ? { mine: split(sides[0]), other: split(sides[1]) } : { mine: split(sides[1]), other: split(sides[0]) };
}

export function buildEntityProfile(input: { query: string; entityType: EntityType; variants: NameVariant[]; hits: SearchHit[] }): EntityProfile {
  const { query, entityType, variants, hits } = input;
  const byMatchType = Object.fromEntries(MATCH_TYPES.map((t) => [t, 0])) as Record<MatchType, number>;
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<RecordKind, number>;
  const status = { active: 0, closed: 0, unknown: 0 };
  const categories = new Map<CaseCategory, number>();
  const jurisdictions = new Map<JurisdictionLevel, number>();
  const roles = new Map<string, number>();
  const years = new Map<number, number>();
  const courts = new Map<string, CourtTally>();
  const counterparties = new Map<string, CounterpartyTally>();
  const attorneys = new Map<string, Tally>();
  const firms = new Map<string, Tally>();
  const judges = new Map<string, Tally>();
  const documents: EntityProfile["documents"] = [];
  const seenDocs = new Set<string>();
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;

  const isSelf = (name: string) => Boolean(matchName(name, variants, entityType));

  for (const h of hits) {
    const r = h.record;
    const rk = r.key;
    for (const t of h.match.types) byMatchType[t] += 1;
    for (const k of r.kinds) byKind[k] += 1;
    status[r.status] += 1;
    categories.set(r.category, (categories.get(r.category) ?? 0) + 1);
    jurisdictions.set(r.court.level, (jurisdictions.get(r.court.level) ?? 0) + 1);

    if (h.match.types.includes("party")) {
      const role = h.match.partyRole?.trim() || "Role not reported";
      roles.set(role, (roles.get(role) ?? 0) + 1);
    }

    const d = primaryDate(h);
    if (d) {
      if (!firstSeen || d < firstSeen) firstSeen = d;
      if (!lastSeen || d > lastSeen) lastSeen = d;
      const y = Number(d.slice(0, 4));
      years.set(y, (years.get(y) ?? 0) + 1);
    }
    const last = r.lastActivity;
    if (last && (!lastSeen || last > lastSeen)) lastSeen = last;

    const court = courts.get(r.court.id) ?? { key: r.court.id, label: r.court.name, level: r.court.level, state: r.court.state, count: 0, recordKeys: [] };
    if (!court.recordKeys.includes(rk)) {
      court.count += 1;
      court.recordKeys.push(rk);
    }
    courts.set(r.court.id, court);

    if (r.judge) bump(judges, normalizeName(r.judge), r.judge, rk);
    for (const a of r.attorneys) if (!isSelf(a.name) || entityType !== "attorney") bump(attorneys, normalizeName(a.name), a.name, rk);
    for (const f of r.firms) bump(firms, firmKey(f), f, rk);

    // Counterparties: party records when captured, otherwise the caption. Relationship is
    // "opposite_caption" only when the caption places the entity on one side and the other
    // name on the other; otherwise it is just "same case".
    const side = captionSideOf(r.caseName, variants, entityType);
    const names = r.partyListCaptured ? r.parties.map((p) => ({ name: p.name, org: p.isOrganization })) : (side ? [...side.mine, ...side.other] : []).map((n) => ({ name: n, org: looksLikeOrganization(n) }));
    for (const p of names) {
      // "[…]" marks names withheld in demo fixtures; they are not real counterparties.
      if (!p.name || p.name.startsWith("[") || isPlaceholderParty(p.name) || isSelf(p.name) || looksLikeLawFirm(p.name)) continue;
      const key = normalizeName(p.name);
      if (!key) continue;
      const relation: CounterpartyTally["relation"] = side?.other.some((o) => normalizeName(o) === key || normalizeName(o).includes(key))
        ? "opposite_caption"
        : side?.mine.some((o) => normalizeName(o) === key)
          ? "co_party"
          : "same_case";
      const t = counterparties.get(key) ?? { key, label: p.name, isOrganization: p.org, relation, count: 0, recordKeys: [] };
      if (!t.recordKeys.includes(rk)) {
        t.count += 1;
        t.recordKeys.push(rk);
      }
      // Keep the most specific relation observed.
      if (relation === "opposite_caption") t.relation = "opposite_caption";
      counterparties.set(key, t);
    }

    for (const doc of [...h.match.mentions, ...r.documents]) {
      if (seenDocs.has(doc.id)) continue;
      seenDocs.add(doc.id);
      documents.push({ ...doc, recordKey: rk, caseName: r.caseName });
    }
  }

  const cp = sorted(counterparties, 60);
  return {
    query,
    entityType,
    overview: {
      records: hits.length,
      byMatchType,
      byKind,
      firstSeen,
      lastSeen,
      status,
      categories: [...categories].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      jurisdictions: [...jurisdictions].map(([level, count]) => ({ level, count })).sort((a, b) => b.count - a.count),
      roles: [...roles].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
      byYear: [...years].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
    },
    courts: sorted(courts, 40),
    counterparties: cp,
    companies: cp.filter((c) => c.isOrganization),
    attorneys: sorted(attorneys, 40),
    firms: sorted(firms, 40),
    judges: sorted(judges, 20),
    documents: documents.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 100),
  };
}
