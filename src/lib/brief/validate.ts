import type { BriefSource } from "./sources";

export const BRIEF_SECTIONS = [
  { key: "what_is_this_case", title: "What is this case?" },
  { key: "parties", title: "Who are the parties?" },
  { key: "why_filed", title: "Why was it filed?" },
  { key: "procedural_posture", title: "Current procedural posture" },
  { key: "important_filings", title: "Important filings" },
  { key: "important_rulings", title: "Important rulings" },
  { key: "latest_activity", title: "Latest activity" },
  { key: "what_happened_next", title: "What happened next?" },
] as const;

export type BriefSectionKey = (typeof BRIEF_SECTIONS)[number]["key"];

export interface RawStatement {
  text: string;
  source_ids: string[];
}

export interface BriefStatement {
  text: string;
  sources: { id: string; label: string; url: string | null }[];
}

export interface BriefSection {
  key: BriefSectionKey;
  title: string;
  statements: BriefStatement[];
  insufficient: boolean;
}

export interface CaseBrief {
  recordKey: string;
  generatedAt: string;
  model: string;
  sections: BriefSection[];
  sources: { id: string; label: string; url: string | null; date: string | null }[];
  droppedStatements: number;
  disclaimer: string;
}

export const INSUFFICIENT = "Insufficient source information.";

export const BRIEF_DISCLAIMER =
  "Generated from the listed court records only. Filings contain allegations, not findings. Verify against the linked sources; this is research information, not legal advice.";

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Numbers and dates in a statement (years, docket numbers, amounts, entry numbers). */
export function numericTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const m of text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)) tokens.add(m[0]);
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) tokens.add(m[0]);
  for (const m of text.matchAll(/\$?\d[\d,.]*\d|\b\d{2,}\b/g)) tokens.add(m[0].replace(/[$,]/g, "").replace(/\.$/, ""));
  return [...tokens].filter((t) => t.replace(/\D/g, "").length >= 2);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function variantsOf(token: string): string[] {
  const out = [token];
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    out.push(`${Number(m)}/${Number(d)}/${y}`, `${m}/${d}/${y}`, `${Number(m)}/${Number(d)}/${y.slice(2)}`, `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`, `${MONTHS[Number(m) - 1]}${Number(d)}${y}`);
  }
  const us = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const [, m, d, y] = us;
    const year = y.length === 2 ? `20${y}` : y;
    out.push(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }
  return out;
}

/**
 * A statement survives only if it cites at least one known source AND every number/date
 * it contains appears in the cited sources. This blocks invented dates, amounts and
 * docket numbers even when the model cites a real source.
 */
export function validateStatement(stmt: RawStatement, byId: Map<string, BriefSource>): BriefStatement | null {
  const text = stmt.text?.trim();
  if (!text) return null;
  const ids = [...new Set((stmt.source_ids ?? []).filter((id) => byId.has(id)))];
  if (ids.length === 0) return null;
  const haystack = norm(ids.map((id) => byId.get(id)!.text + " " + byId.get(id)!.label).join(" "));
  for (const tok of numericTokens(text)) {
    if (!variantsOf(tok).some((v) => haystack.includes(norm(v)))) return null;
  }
  return { text, sources: ids.map((id) => ({ id, label: byId.get(id)!.label, url: byId.get(id)!.url })) };
}

export function assembleBrief(
  recordKey: string,
  model: string,
  raw: Record<string, { statements: RawStatement[]; insufficient?: boolean }>,
  sources: BriefSource[],
  now = new Date(),
): CaseBrief {
  const byId = new Map(sources.map((s) => [s.id, s]));
  let dropped = 0;
  const sections: BriefSection[] = BRIEF_SECTIONS.map(({ key, title }) => {
    const input = raw[key];
    const statements: BriefStatement[] = [];
    for (const s of input?.statements ?? []) {
      const v = validateStatement(s, byId);
      if (v) statements.push(v);
      else dropped += 1;
    }
    return { key, title, statements, insufficient: statements.length === 0 };
  });
  return {
    recordKey,
    generatedAt: now.toISOString(),
    model,
    sections,
    sources: sources.map((s) => ({ id: s.id, label: s.label, url: s.url, date: s.date })),
    droppedStatements: dropped,
    disclaimer: BRIEF_DISCLAIMER,
  };
}
