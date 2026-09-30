import { createHash } from "node:crypto";
import type { EntityType, NameVariant, SearchHit } from "@/lib/domain/types";
import type {
  ClusterConfidence,
  IdentityCluster,
  IdentityCorrection,
  IdentityEdge,
  IdentityResolution,
  IdentitySignal,
} from "@/lib/domain/identity";
import { comparePersonNames, isPlaceholderParty, normalizeName, parseCompanyName, parsePersonName } from "@/lib/text/names";
import { normalizeDocketNumber } from "@/lib/providers/courtlistener/mappers";

/**
 * IDENTITY RESOLUTION
 *
 * Groups search results into possible identities using only objective relationships
 * present in the records (names, counsel, co-parties, courts, dockets). Every grouping is
 * explained, and the output is never presented as proof of identity.
 */

export const ALGORITHM_VERSION = "ir-1.0";
export const LINK_THRESHOLD = 3;

export const DISCLAIMER =
  "Identity Resolution groups records using objective signals found in the records themselves (names, counsel, co-parties, courts). It is not proof of identity and can be wrong. Review the underlying sources before relying on any grouping.";

const GENERIC_PARTIES = /^(united states( of america)?|usa|u\.s\.a\.?|the people|people of the state of .*|state of .*|commonwealth of .*|commissioner of .*|internal revenue service|social security administration|united states trustee|u\.s\. trustee|does? \d.*|john doe.*|jane doe.*|unknown.*)$/i;

interface Profile {
  hit: SearchHit;
  key: string;
  name: string;
  person: ReturnType<typeof parsePersonName> | null;
  company: ReturnType<typeof parseCompanyName> | null;
  courtId: string;
  courtLabel: string;
  state: string | null;
  docketCore: string | null;
  coParties: Map<string, string>;
  attorneys: Map<string, string>;
  firms: Map<string, string>;
  from: string | null;
  to: string | null;
}

function normSet(names: string[], exclude: string): Map<string, string> {
  const m = new Map<string, string>();
  const ex = normalizeName(exclude);
  for (const n of names) {
    const k = normalizeName(n);
    if (!k || k === ex || GENERIC_PARTIES.test(n.trim()) || isPlaceholderParty(n) || n.includes("name withheld")) continue;
    m.set(k, n);
  }
  return m;
}

function nameBearing(hit: SearchHit): boolean {
  return ["party", "caption", "attorney", "firm"].includes(hit.match.field) && Boolean(hit.match.matchedText);
}

function profile(hit: SearchHit, isPerson: boolean): Profile {
  const name = hit.match.matchedText;
  const r = hit.record;
  const dates = [r.dateFiled, r.dateTerminated, r.lastActivity, ...r.opinions.map((o) => o.dateFiled)].filter(Boolean) as string[];
  dates.sort();
  return {
    hit,
    key: hit.id,
    name,
    person: isPerson ? parsePersonName(name.split(/,\s*(individually|as |d\/b\/a|dba)/i)[0]) : null,
    company: isPerson ? null : parseCompanyName(name),
    courtId: r.court.id,
    courtLabel: r.court.citation ?? r.court.name,
    state: r.court.state,
    docketCore: normalizeDocketNumber(r.docketNumber),
    coParties: normSet(r.parties.map((p) => p.name), name),
    attorneys: normSet(r.attorneys.map((a) => a.name), name),
    firms: normSet(r.firms, name),
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
  };
}

function shared(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of a) if (b.has(k)) out.push(v);
  return out;
}

function compatible(a: Profile, b: Profile): { ok: boolean; exact: boolean } {
  if (a.person && b.person) {
    const rel = comparePersonNames(a.person, b.person);
    if (rel === "conflicting") return { ok: false, exact: false };
    const bothMiddle = a.person.middle.length > 0 && b.person.middle.length > 0;
    return { ok: true, exact: rel === "identical" && (bothMiddle || a.person.middle.length === b.person.middle.length) };
  }
  if (a.company && b.company) {
    if (a.company.core !== b.company.core) return { ok: false, exact: false };
    if (a.company.suffixClass && b.company.suffixClass && a.company.suffixClass !== b.company.suffixClass) return { ok: false, exact: false };
    return { ok: true, exact: a.company.suffixClass === b.company.suffixClass };
  }
  return { ok: false, exact: false };
}

export function scorePair(a: Profile, b: Profile, isPerson: boolean): IdentityEdge | null {
  const gate = compatible(a, b);
  if (!gate.ok) return null;
  const signals: IdentitySignal[] = [];
  if (gate.exact) {
    signals.push({ kind: "exact_full_name", label: isPerson ? "same full name" : "same registered name", weight: isPerson ? 1.5 : 2.5 });
  } else if (isPerson && a.person?.middle.length && b.person?.middle.length) {
    signals.push({ kind: "compatible_middle", label: "compatible middle name/initial", weight: 0.5 });
  }
  const atty = shared(a.attorneys, b.attorneys);
  if (atty.length) signals.push({ kind: "shared_attorney", label: `same attorney (${atty.slice(0, 2).join(", ")})`, weight: 3 });
  const firms = shared(a.firms, b.firms);
  if (firms.length) signals.push({ kind: "shared_firm", label: `same law firm (${firms.slice(0, 2).join(", ")})`, weight: 2 });
  const co = shared(a.coParties, b.coParties);
  if (co.length) signals.push({ kind: "shared_co_party", label: `same co-party (${co.slice(0, 2).join(", ")})`, weight: 2.5 });
  if (a.courtId === b.courtId && a.courtId !== "unknown") signals.push({ kind: "same_court", label: `same court (${a.courtLabel})`, weight: 1.5 });
  else if (a.state && a.state === b.state) signals.push({ kind: "same_state", label: `same state (${a.state})`, weight: 1 });
  if (a.docketCore && a.docketCore === b.docketCore && a.courtId !== b.courtId) signals.push({ kind: "related_docket", label: `related docket (${a.docketCore})`, weight: 3 });
  const score = signals.reduce((s, x) => s + x.weight, 0);
  return { a: a.key, b: b.key, score, signals };
}

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra);
  }
}

const STRONG_KINDS = new Set(["shared_attorney", "shared_co_party", "shared_firm", "related_docket"]);

function classify(members: Profile[], edges: IdentityEdge[], isPerson: boolean): { confidence: ClusterConfidence; explanation: string } {
  if (members.length === 1) {
    const m = members[0];
    const weak = m.hit.match.types.includes("possible_identity");
    if (weak) return { confidence: "weak", explanation: "Single record matched through a broader name variant." };
    if (isPerson) {
      return m.person && m.person.middle.length
        ? { confidence: "possible", explanation: "Single record; the full name including middle name matches." }
        : { confidence: "weak", explanation: "Single record; name match only." };
    }
    return { confidence: "possible", explanation: "Single record with a matching entity name." };
  }
  const kinds = new Set(edges.flatMap((e) => e.signals.map((s) => s.kind)));
  const strongEdges = edges.filter((e) => e.signals.some((s) => STRONG_KINDS.has(s.kind)));
  const allHaveStrong = members.every((m) => strongEdges.some((e) => e.a === m.key || e.b === m.key));
  if (allHaveStrong && kinds.size >= 2) return { confidence: "strong", explanation: "Every record is linked by shared counsel, co-parties or related dockets, plus at least one other signal." };
  if (strongEdges.length > 0) return { confidence: "possible", explanation: "Some records share counsel or co-parties; others are linked only by name and location." };
  return { confidence: "weak", explanation: "Records are linked by name and location only." };
}

function describeEdges(edges: IdentityEdge[]): string[] {
  const combos = new Map<string, number>();
  for (const e of edges) {
    const label = e.signals.map((s) => s.label).join(" + ");
    const key = label.charAt(0).toUpperCase() + label.slice(1);
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  return [...combos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => (n > 1 ? `${k} (${n} links)` : k));
}

function clusterIdFor(memberKeys: string[]): string {
  return "c_" + createHash("sha1").update([...memberKeys].sort()[0]).digest("hex").slice(0, 12);
}

export function entityKeyFor(query: string, type: EntityType): string {
  return `${type}:${normalizeName(query)}`;
}

export function resolveIdentities(input: {
  hits: SearchHit[];
  entityType: EntityType;
  query: string;
  variants: NameVariant[];
  corrections?: IdentityCorrection[];
}): IdentityResolution {
  const isPerson = input.entityType === "person" || input.entityType === "attorney" || input.entityType === "unknown";
  const entityKey = entityKeyFor(input.query, input.entityType);
  const eligible = input.hits.filter(nameBearing);
  const unresolved = input.hits.filter((h) => !nameBearing(h)).map((h) => h.id);
  const profiles = eligible.map((h) => profile(h, isPerson));
  const byKey = new Map(profiles.map((p) => [p.key, p]));

  const edges: IdentityEdge[] = [];
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const e = scorePair(profiles[i], profiles[j], isPerson);
      if (e) edges.push(e);
    }
  }
  const uf = new UnionFind();
  for (const p of profiles) uf.find(p.key);
  for (const e of edges) if (e.score >= LINK_THRESHOLD) uf.union(e.a, e.b);

  let groups = new Map<string, string[]>();
  for (const p of profiles) {
    const r = uf.find(p.key);
    groups.set(r, [...(groups.get(r) ?? []), p.key]);
  }

  // Apply the user's corrections in order. Cluster references use a member ("anchor") key.
  const rejected = new Set<string>();
  const confirmed = new Set<string>();
  const adjusted = new Set<string>();
  const findGroup = (key: string) => [...groups.entries()].find(([, ms]) => ms.includes(key))?.[0] ?? null;
  for (const c of [...(input.corrections ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!byKey.has(c.recordKey) && c.action !== "merge") continue;
    const from = findGroup(c.recordKey);
    if (c.action === "reject") {
      if (from) groups.set(from, groups.get(from)!.filter((k) => k !== c.recordKey));
      rejected.add(c.recordKey);
      if (from) adjusted.add(from);
    } else if (c.action === "confirm") {
      confirmed.add(c.recordKey);
      if (from) adjusted.add(from);
    } else if (c.action === "split" && from) {
      groups.set(from, groups.get(from)!.filter((k) => k !== c.recordKey));
      groups.set(`split:${c.recordKey}`, [c.recordKey]);
      adjusted.add(from);
      adjusted.add(`split:${c.recordKey}`);
    } else if (c.action === "move" && from && c.targetClusterId) {
      const to = findGroup(c.targetClusterId);
      if (to && to !== from) {
        groups.set(from, groups.get(from)!.filter((k) => k !== c.recordKey));
        groups.set(to, [...groups.get(to)!, c.recordKey]);
        adjusted.add(from);
        adjusted.add(to);
      }
    } else if (c.action === "merge" && c.sourceClusterId && c.targetClusterId) {
      const src = findGroup(c.sourceClusterId);
      const dst = findGroup(c.targetClusterId);
      if (src && dst && src !== dst) {
        groups.set(dst, [...groups.get(dst)!, ...groups.get(src)!]);
        groups.delete(src);
        adjusted.add(dst);
      }
    }
  }
  groups = new Map([...groups.entries()].filter(([, ms]) => ms.length > 0));

  const rank: Record<ClusterConfidence, number> = { strong: 0, possible: 1, weak: 2, unresolved: 3 };
  const clusters: IdentityCluster[] = [...groups.entries()].map(([gid, keys]) => {
    const members = keys.map((k) => byKey.get(k)!).filter(Boolean);
    const memberSet = new Set(keys);
    const internal = edges.filter((e) => memberSet.has(e.a) && memberSet.has(e.b) && e.score >= LINK_THRESHOLD);
    let { confidence, explanation } = classify(members, internal, isPerson);
    const userAdjusted = adjusted.has(gid) || keys.some((k) => confirmed.has(k));
    if (keys.some((k) => confirmed.has(k))) explanation += " Includes records you confirmed.";
    if (members.length > 1 && internal.length === 0) {
      confidence = "unresolved";
      explanation = "Grouped by your corrections; no automatic signals link these records.";
    }
    const dates = members.flatMap((m) => [m.from, m.to]).filter(Boolean) as string[];
    dates.sort();
    const courts = [...new Set(members.map((m) => m.courtLabel))];
    const states = [...new Set(members.map((m) => m.state).filter(Boolean) as string[])];
    const nameForms = [...new Set(members.map((m) => m.name))];
    const years = dates.length ? `${dates[0].slice(0, 4)}${dates.at(-1)!.slice(0, 4) !== dates[0].slice(0, 4) ? `–${dates.at(-1)!.slice(0, 4)}` : ""}` : "dates unknown";
    return {
      id: clusterIdFor(keys),
      label: `${nameForms[0]} — ${courts.slice(0, 2).join(", ")}${courts.length > 2 ? ` +${courts.length - 2}` : ""} · ${years}`,
      confidence,
      confidenceExplanation: explanation,
      memberHitIds: keys,
      nameForms,
      courts,
      states,
      dateRange: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
      groupingReasons: members.length === 1 ? [members[0].hit.match.types.includes("possible_identity") ? "Broader name variant only" : "Name match only (single record)"] : describeEdges(internal),
      edges: internal,
      userAdjusted,
    };
  });
  clusters.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.memberHitIds.length - a.memberHitIds.length);

  return {
    entityKey,
    algorithmVersion: ALGORITHM_VERSION,
    clusters,
    unresolvedHitIds: unresolved,
    rejectedHitIds: [...rejected],
    disclaimer: DISCLAIMER,
  };
}
