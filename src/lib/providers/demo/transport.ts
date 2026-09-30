import "server-only";
import type { z } from "zod";
import snapshot from "./fixtures/courtlistener-snapshot.json";
import type { ClFetcher, FetchOptions } from "@/lib/providers/courtlistener/client";
import type { ProviderResult } from "@/lib/providers/types";
import { normalizeName } from "@/lib/text/names";
import { normalizeDocketNumber } from "@/lib/providers/courtlistener/mappers";

/**
 * Demo transport: answers CourtListener-shaped requests from a curated snapshot of real
 * public records (captured 2026-09-30, see scripts/curate-fixtures.py). It runs the same
 * schemas, mappers and classification as live mode. It is a small emulator, not a search
 * engine: queries outside the snapshot return nothing, and the UI says so.
 */

export const DEMO_CAPTURED_AT = "2026-09-30T03:00:00.000Z";

type AnyRecord = Record<string, unknown>;
type Page = { count: number; next: null; previous: null; results: AnyRecord[] };

const S = snapshot as unknown as Record<string, Page | AnyRecord>;

function page(results: AnyRecord[]): Page {
  return { count: results.length, next: null, previous: null, results };
}

/** Phrases from a query; "a b"~1 becomes a pattern allowing one extra word between terms. */
function extractPhrases(q: string): string[] {
  return [...q.matchAll(/"([^"]+)"(~\d)?/g)].map((m) => (m[2] ? `~${normalizeName(m[1])}` : normalizeName(m[1]))).filter(Boolean);
}

function phraseMatches(text: string, phrase: string): boolean {
  const hay = ` ${normalizeName(text)} `;
  if (!phrase.startsWith("~")) return hay.includes(` ${phrase} `);
  const words = phrase.slice(1).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(` ${words.join("(?: \\S+)? ")} `).test(hay);
}

function fieldPhrases(q: string, field: string): string[] {
  const re = new RegExp(`${field}:\\(([^)]*)\\)`, "g");
  const out: string[] = [];
  for (const m of q.matchAll(re)) out.push(...extractPhrases(m[1]));
  return out;
}

function includesAny(values: unknown, phrases: string[]): boolean {
  const list = Array.isArray(values) ? values : [values];
  return list.some((v) => typeof v === "string" && phrases.some((p) => phraseMatches(v, p)));
}

function allDockets(): AnyRecord[] {
  const seen = new Set<number>();
  const out: AnyRecord[] = [];
  for (const key of ["search_d_docket_epic_v_apple", "search_r_party_epic", "search_d_attorney_bornstein"]) {
    for (const r of (S[key] as Page).results) {
      const id = r.docket_id as number;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out;
}

function sortResults(results: AnyRecord[], orderBy: string | null, field: string): AnyRecord[] {
  if (!orderBy || orderBy.startsWith("score")) return results;
  const dir = orderBy.endsWith("asc") ? 1 : -1;
  return [...results].sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) * dir);
}

function inDateRange(value: unknown, after: string | null, before: string | null): boolean {
  if (!after && !before) return true;
  if (typeof value !== "string") return false;
  if (after && value < after) return false;
  if (before && value > before) return false;
  return true;
}

function applyCourt(results: AnyRecord[], court: string | null): AnyRecord[] {
  if (!court) return results;
  const ids = new Set(court.split(/\s+/));
  return results.filter((r) => ids.has(String(r.court_id)));
}

function search(params: URLSearchParams): Page {
  const type = params.get("type") ?? "o";
  const q = params.get("q") ?? "";
  const orderBy = params.get("order_by");
  const after = params.get("filed_after");
  const before = params.get("filed_before");
  const court = params.get("court");

  if (type === "d" || type === "r") {
    let results = allDockets();
    const idLookup = q.match(/docket_id:\(([^)]*)\)/);
    if (idLookup) {
      const ids = new Set(idLookup[1].split(/\s+OR\s+/).map((s) => Number(s.trim())));
      return page(results.filter((r) => ids.has(r.docket_id as number)));
    }
    const dn = params.get("docket_number");
    const caseName = params.get("case_name");
    if (dn) {
      const want = normalizeDocketNumber(dn);
      results = results.filter((r) => normalizeDocketNumber(String(r.docketNumber ?? "")) === want);
    } else if (caseName) {
      const want = normalizeName(caseName);
      results = results.filter((r) => normalizeName(String(r.caseName ?? "")).includes(want));
    } else {
      const party = fieldPhrases(q, "party");
      const caption = fieldPhrases(q, "caseName");
      const atty = fieldPhrases(q, "attorney");
      const firm = fieldPhrases(q, "firm");
      results = results.filter(
        (r) =>
          (party.length && includesAny(r.party, party)) ||
          (caption.length && includesAny(r.caseName, caption)) ||
          (atty.length && includesAny(r.attorney, atty)) ||
          (firm.length && includesAny(r.firm, firm)),
      );
    }
    if (q.includes("-dateTerminated:[* TO *]")) results = results.filter((r) => !r.dateTerminated);
    else if (q.includes("dateTerminated:[* TO *]")) results = results.filter((r) => Boolean(r.dateTerminated));
    results = applyCourt(results, court).filter((r) => inDateRange(r.dateFiled, after, before));
    return page(sortResults(results, orderBy, "dateFiled"));
  }

  if (type === "o") {
    const caption = (S.search_o_caption_epic as Page).results;
    const mentions = (S.search_o_mention_epic as Page).results;
    const dn = params.get("docket_number");
    const caseName = params.get("case_name");
    let results: AnyRecord[];
    if (dn) {
      const want = normalizeDocketNumber(dn);
      results = [...caption, ...mentions].filter((r) => normalizeDocketNumber(String(r.docketNumber ?? "")) === want);
    } else if (caseName) {
      const want = normalizeName(caseName);
      results = [...caption, ...mentions].filter((r) => normalizeName(String(r.caseName ?? "")).includes(want));
    } else {
      const phrases = extractPhrases(q);
      // The mention fixtures were captured for the phrase "Epic Games" (full-text hits outside the caption).
      const mentionMatch = phrases.some((p) => p.replace(/^~/, "") === "epic games" || p.replace(/^~/, "") === "epic games inc");
      results = [...caption.filter((r) => includesAny(r.caseName, phrases)), ...(mentionMatch ? mentions : [])];
    }
    results = applyCourt(results, court).filter((r) => inDateRange(r.dateFiled, after, before));
    return page(sortResults(results, orderBy, "dateFiled"));
  }

  if (type === "rd") {
    const phrases = extractPhrases(q);
    const docs = (S.search_rd_mention_epic as Page).results.filter((r) => includesAny(r.description, phrases));
    return page(sortResults(docs, orderBy, "entry_date_filed"));
  }
  return page([]);
}

function route(path: string, params: URLSearchParams): unknown | null {
  if (path === "search/") return search(params);
  const docket = path.match(/^dockets\/(\d+)\/$/);
  if (docket) return docket[1] === "17442392" ? S.docket_17442392 : null;
  if (path === "parties/") return params.get("docket") === "17442392" ? S.parties_17442392 : page([]);
  if (path === "attorneys/") return page([]);
  if (path === "docket-entries/") return params.get("docket") === "17442392" && !params.get("cursor") ? S.docket_entries_17442392 : page([]);
  return null;
}

export const demoFetch: ClFetcher = async <T extends z.ZodTypeAny>(opts: FetchOptions<T>): Promise<ProviderResult<z.infer<T>>> => {
  const started = Date.now();
  if ((opts.method ?? "GET") !== "GET") {
    return { ok: false, error: { code: "not_supported", message: "Demo mode is read-only." }, meta: { requests: 0, cached: true, ms: 0 } };
  }
  const raw = route(opts.path, opts.params ?? new URLSearchParams());
  if (raw == null) {
    return { ok: false, error: { code: "not_found", message: "This record is not part of the demo snapshot." }, meta: { requests: 0, cached: true, ms: Date.now() - started } };
  }
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "upstream", message: `Demo fixture failed validation: ${parsed.error.issues[0]?.message}` }, meta: { requests: 0, cached: true, ms: 0 } };
  }
  return { ok: true, data: parsed.data, meta: { requests: 0, cached: true, ms: Date.now() - started } };
};

export const DEMO_QUERIES = [
  { query: "Epic Games", type: "company", note: "Company: dockets, opinions, filing mentions" },
  { query: "4:20-cv-05640", type: "docket_number", note: "Docket: Epic Games, Inc. v. Apple Inc. (N.D. Cal.)" },
  { query: "Gary Bornstein", type: "attorney", note: "Attorney of record across technology matters" },
  { query: "Google LLC", type: "company", note: "Company: appears alongside Epic Games matters" },
] as const;
