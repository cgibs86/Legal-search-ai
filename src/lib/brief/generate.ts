import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { log, errorMessage } from "@/lib/log";
import { assembleBrief, BRIEF_SECTIONS, type CaseBrief } from "./validate";
import { fingerprint, type BriefSource } from "./sources";

const Statement = z.object({
  text: z.string().describe("One factual sentence supported by the cited sources."),
  source_ids: z.array(z.string()).describe("IDs of the sources (e.g. S3) that support this sentence."),
});
const Section = z.object({ statements: z.array(Statement), insufficient: z.boolean() });
const BriefSchema = z.object(Object.fromEntries(BRIEF_SECTIONS.map((s) => [s.key, Section])) as Record<(typeof BRIEF_SECTIONS)[number]["key"], typeof Section>);

const SYSTEM = `You write concise case briefs for a court-records research product.

Rules:
- Use ONLY the numbered SOURCES provided. Do not use outside knowledge about the case, the parties, the lawyers or the court, even if you recognize them.
- Every statement must cite one or more source IDs that directly support it. Do not cite a source for anything it does not say.
- Keep dates, docket numbers, amounts and entry numbers exactly as they appear in the sources.
- Filings contain allegations. Attribute them ("the complaint alleges", "Apple argued"). Never state an allegation as fact.
- Do not characterize any person or company beyond what the sources state. No speculation about outcomes, motives or character. No legal advice.
- If the sources do not support a section, return no statements for it and set insufficient to true.
- Keep each section to at most 4 short sentences.

Sections: ${BRIEF_SECTIONS.map((s) => `${s.key} = "${s.title}"`).join("; ")}.`;

export class BriefError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "refused" | "failed",
  ) {
    super(message);
  }
}

function renderSources(sources: BriefSource[]): string {
  return sources.map((s) => `<source id="${s.id}" label="${s.label.replace(/"/g, "'")}"${s.date ? ` date="${s.date}"` : ""}>\n${s.text}\n</source>`).join("\n\n");
}

async function cached(recordKey: string, fp: string, model: string): Promise<CaseBrief | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("ai_briefs").select("brief").eq("record_key", recordKey).eq("source_fingerprint", fp).eq("model", model).maybeSingle();
  return (data?.brief as CaseBrief) ?? null;
}

async function store(recordKey: string, fp: string, model: string, brief: CaseBrief) {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("ai_briefs").upsert({ record_key: recordKey, source_fingerprint: fp, model, brief });
}

export async function generateBrief(recordKey: string, sources: BriefSource[]): Promise<{ brief: CaseBrief; cached: boolean }> {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) throw new BriefError("AI Case Brief is not configured (ANTHROPIC_API_KEY).", "not_configured");
  const model = env.ANTHROPIC_MODEL;
  const fp = fingerprint(sources);
  const hit = await cached(recordKey, fp, model);
  if (hit) return { brief: hit, cached: true };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { format: betaZodOutputFormat(BriefSchema), effort: "medium" },
      messages: [{ role: "user", content: `SOURCES:\n\n${renderSources(sources)}\n\nWrite the brief now. Cite source IDs for every statement.` }],
    });
    if (response.stop_reason === "refusal") throw new BriefError("The model declined to summarize these records.", "refused");
    const parsed = response.parsed_output;
    if (!parsed) throw new BriefError("The model returned an unreadable brief.", "failed");
    const brief = assembleBrief(recordKey, response.model ?? model, parsed as Record<string, { statements: { text: string; source_ids: string[] }[]; insufficient?: boolean }>, sources);
    await store(recordKey, fp, model, brief);
    log.info("brief.generated", { recordKeyHash: fp.slice(0, 8), dropped: brief.droppedStatements, model: brief.model });
    return { brief, cached: false };
  } catch (e) {
    if (e instanceof BriefError) throw e;
    log.error("brief.failed", { error: errorMessage(e) });
    throw new BriefError("Brief generation failed. Try again shortly.", "failed");
  }
}
