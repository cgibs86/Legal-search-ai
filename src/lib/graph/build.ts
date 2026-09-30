import type { SearchHit } from "@/lib/domain/types";
import { captionSides, containsPhrase, isPlaceholderParty, normalizeName } from "@/lib/text/names";
import { normalizeDocketNumber } from "@/lib/providers/courtlistener/mappers";

/**
 * LITIGATION GRAPH
 *
 * Nodes and edges come only from fields present in the retrieved records. Relationships
 * that would require inference (e.g. which attorney works at which firm, who sued whom
 * when roles are unknown) are not drawn; caption-based adversity is labeled as such.
 */

export type GraphNodeKind = "entity" | "case" | "court" | "judge" | "attorney" | "firm" | "party";

export type GraphRelation =
  | "party_to"
  | "caption_party"
  | "counsel_in"
  | "firm_in"
  | "represented"
  | "heard_in"
  | "presided_over"
  | "mentioned_in"
  | "adverse_in_caption"
  | "related_case";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  caseKeys: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  label: string;
  evidence: string;
  recordKey: string;
}

export interface GraphInsight {
  id: string;
  text: string;
  nodeId: string;
  count: number;
  recordKeys: string[];
  kind: "repeat_firm" | "repeat_attorney" | "repeat_co_party" | "repeat_adverse" | "repeat_court" | "repeat_judge" | "co_occurrence" | "velocity";
}

export interface LitigationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  insights: GraphInsight[];
  truncated: boolean;
}

const RELATION_LABEL: Record<GraphRelation, string> = {
  party_to: "Party to",
  caption_party: "Named in caption of",
  counsel_in: "Counsel in",
  firm_in: "Firm appeared in",
  represented: "Represented",
  heard_in: "Heard in",
  presided_over: "Presided over",
  mentioned_in: "Mentioned in",
  adverse_in_caption: "Opposite side of caption",
  related_case: "Related case",
};

const MAX_PER_CASE = 10;
const MAX_CASES = 60;

function shortCase(name: string): string {
  return name.length > 48 ? name.slice(0, 46) + "…" : name;
}

export function buildLitigationGraph(entityLabel: string, hits: SearchHit[], opts: { advanced?: boolean } = {}): LitigationGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const entityNorm = normalizeName(entityLabel);
  const truncated = hits.length > MAX_CASES;
  const use = hits.slice(0, MAX_CASES);

  const node = (id: string, kind: GraphNodeKind, label: string, caseKey?: string) => {
    const n = nodes.get(id) ?? { id, kind, label, caseKeys: [] };
    if (caseKey && !n.caseKeys.includes(caseKey)) n.caseKeys.push(caseKey);
    nodes.set(id, n);
    return n;
  };
  const edge = (source: string, target: string, relation: GraphRelation, evidence: string, recordKey: string) => {
    const id = `${source}|${relation}|${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target, relation, label: RELATION_LABEL[relation], evidence, recordKey });
  };

  node("entity", "entity", entityLabel);
  const byDocket = new Map<string, string>();
  for (const h of use) {
    const dn = normalizeDocketNumber(h.record.docketNumber);
    if (dn) byDocket.set(dn, h.record.key);
  }

  for (const h of use) {
    const r = h.record;
    const caseId = `case:${r.key}`;
    node(caseId, "case", shortCase(r.caseName), r.key);
    node("entity", "entity", entityLabel, r.key);

    const m = h.match;
    if (m.types.includes("party")) {
      const rel: GraphRelation = m.field === "caption" ? "caption_party" : "party_to";
      edge("entity", caseId, rel, m.partyRole ? `${m.partyRole} (${m.matchedText})` : `Listed as "${m.matchedText}"`, r.key);
    } else if (m.types.includes("attorney")) {
      edge("entity", caseId, "counsel_in", `Listed as counsel: "${m.matchedText}"`, r.key);
    } else if (m.types.includes("mention")) {
      edge("entity", caseId, "mentioned_in", "Named in a document or opinion text", r.key);
    } else {
      edge("entity", caseId, "party_to", "Docket match", r.key);
    }

    const courtId = `court:${r.court.id}`;
    node(courtId, "court", r.court.citation ?? r.court.name, r.key);
    edge(caseId, courtId, "heard_in", `${r.caseName} is in ${r.court.name}`, r.key);

    if (r.judge) {
      const jid = `judge:${normalizeName(r.judge)}`;
      node(jid, "judge", r.judge, r.key);
      edge(jid, caseId, "presided_over", `Assigned judge listed on the record`, r.key);
    }

    for (const a of r.attorneys.slice(0, MAX_PER_CASE)) {
      const aNorm = normalizeName(a.name);
      if (aNorm === entityNorm) continue;
      const aid = `attorney:${aNorm}`;
      node(aid, "attorney", a.name, r.key);
      edge(aid, caseId, "counsel_in", "Listed as counsel of record", r.key);
      for (const rep of a.representing.slice(0, 3)) {
        if (containsPhrase(rep, entityLabel)) edge(aid, "entity", "represented", `Party record lists this attorney for "${rep}"`, r.key);
      }
    }
    for (const f of r.firms.slice(0, MAX_PER_CASE)) {
      const fNorm = normalizeName(f);
      if (fNorm === entityNorm) continue;
      const fid = `firm:${fNorm}`;
      node(fid, "firm", f, r.key);
      edge(fid, caseId, "firm_in", "Firm listed among counsel on the docket", r.key);
    }

    const sides = captionSides(r.caseName);
    const entitySide = sides.findIndex((s) => containsPhrase(s, entityLabel) || containsPhrase(s, m.matchedText || entityLabel));
    for (const p of r.parties.slice(0, MAX_PER_CASE)) {
      const pNorm = normalizeName(p.name);
      if (!pNorm || isPlaceholderParty(p.name) || p.name.includes("name withheld")) continue;
      if (pNorm === normalizeName(m.matchedText) || containsPhrase(p.name, entityLabel)) continue;
      const pid = `party:${pNorm}`;
      node(pid, "party", p.name, r.key);
      edge(pid, caseId, p.roleSource === "caption" ? "caption_party" : "party_to", p.role ? `Role: ${p.role}` : p.roleSource === "caption" ? "Named in caption" : "Listed as a party", r.key);
      if (entitySide >= 0 && sides.length === 2) {
        const pSide = sides.findIndex((s) => containsPhrase(s, p.name));
        if (pSide >= 0 && pSide !== entitySide) edge("entity", pid, "adverse_in_caption", `Opposite sides of the caption in ${r.caseName}`, r.key);
      }
    }

    for (const o of r.opinions) {
      const text = h.match.mentions.map((d) => d.snippet?.segments.map((s) => s.text).join("") ?? "").join(" ");
      for (const mm of text.matchAll(/D\.C\.\s*Nos?\.?\s*([0-9:]+-?[a-z]{2}-?\d{3,6})/gi)) {
        const dn = normalizeDocketNumber(mm[1]);
        const target = dn ? byDocket.get(dn) : undefined;
        if (target && target !== r.key) edge(caseId, `case:${target}`, "related_case", `Appellate opinion ${o.caseName} lists lower-court docket ${mm[1]}`, r.key);
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], insights: buildInsights(entityLabel, [...nodes.values()], [...edges.values()], use, Boolean(opts.advanced)), truncated };
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

export function buildInsights(entityLabel: string, nodes: GraphNode[], edges: GraphEdge[], hits: SearchHit[], advanced: boolean): GraphInsight[] {
  const insights: GraphInsight[] = [];
  const minRepeat = hits.length >= 20 ? 3 : 2;
  const templates: Partial<Record<GraphNodeKind, (n: GraphNode, c: number) => { text: string; kind: GraphInsight["kind"] }>> = {
    firm: (n, c) => ({ text: `${entityLabel} appears in ${c} matters where ${n.label} is listed among counsel.`, kind: "repeat_firm" }),
    attorney: (n, c) => ({ text: `${n.label} appears as counsel in ${c} of these matters.`, kind: "repeat_attorney" }),
    party: (n, c) => ({ text: `${entityLabel} and ${n.label} are both named in ${c} matters.`, kind: "repeat_co_party" }),
    court: (n, c) => ({ text: `${c} ${plural(c, "matter is", "matters are")} in ${n.label}.`, kind: "repeat_court" }),
    judge: (n, c) => ({ text: `Judge ${n.label} is listed on ${c} matters.`, kind: "repeat_judge" }),
  };
  for (const n of nodes) {
    const t = templates[n.kind];
    if (!t) continue;
    const c = n.caseKeys.length;
    if (c < minRepeat) continue;
    const { text, kind } = t(n, c);
    insights.push({ id: `ins:${n.id}`, text, nodeId: n.id, count: c, recordKeys: n.caseKeys, kind });
  }
  const adverse = new Map<string, string[]>();
  for (const e of edges) if (e.relation === "adverse_in_caption") adverse.set(e.target, [...(adverse.get(e.target) ?? []), e.recordKey]);
  for (const [target, keys] of adverse) {
    const uniq = [...new Set(keys)];
    if (uniq.length < 2) continue;
    const label = nodes.find((n) => n.id === target)?.label ?? target;
    insights.push({ id: `ins:adv:${target}`, text: `${entityLabel} and ${label} appear on opposite sides of the caption in ${uniq.length} matters.`, nodeId: target, count: uniq.length, recordKeys: uniq, kind: "repeat_adverse" });
  }

  if (advanced) {
    // Co-occurrence: the same firm appearing with the same judge across several matters.
    const firmByCase = new Map<string, string[]>();
    const judgeByCase = new Map<string, string>();
    for (const e of edges) {
      if (e.relation === "firm_in") firmByCase.set(e.recordKey, [...(firmByCase.get(e.recordKey) ?? []), e.source]);
      if (e.relation === "presided_over") judgeByCase.set(e.recordKey, e.source);
    }
    const pairs = new Map<string, string[]>();
    for (const [key, firms] of firmByCase) {
      const judge = judgeByCase.get(key);
      if (!judge) continue;
      for (const f of firms) pairs.set(`${f}|${judge}`, [...(pairs.get(`${f}|${judge}`) ?? []), key]);
    }
    for (const [pair, keys] of pairs) {
      if (keys.length < 2) continue;
      const [f, j] = pair.split("|");
      const fl = nodes.find((n) => n.id === f)?.label;
      const jl = nodes.find((n) => n.id === j)?.label;
      insights.push({ id: `ins:co:${pair}`, text: `${fl} appears before Judge ${jl} in ${keys.length} of these matters.`, nodeId: f, count: keys.length, recordKeys: keys, kind: "co_occurrence" });
    }
    // Filing velocity by year (docket filing dates only).
    const years = new Map<string, number>();
    for (const h of hits) if (h.record.dateFiled) years.set(h.record.dateFiled.slice(0, 4), (years.get(h.record.dateFiled.slice(0, 4)) ?? 0) + 1);
    const sorted = [...years.entries()].sort();
    if (sorted.length >= 2) {
      const peak = [...sorted].sort((a, b) => b[1] - a[1])[0];
      insights.push({ id: "ins:velocity", text: `Most retrieved matters were filed in ${peak[0]} (${peak[1]}). Filing years span ${sorted[0][0]}–${sorted.at(-1)![0]}.`, nodeId: "entity", count: peak[1], recordKeys: [], kind: "velocity" });
    }
  }
  return insights.sort((a, b) => b.count - a.count).slice(0, 12);
}
