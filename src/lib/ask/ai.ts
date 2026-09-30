import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getEnv } from "@/lib/config/env";
import type { AskSpec } from "./parse";

/**
 * Optional: when the rule-based parser doesn't understand a question, ask Claude to
 * translate it into the same filter spec. The model never sees record contents and never
 * answers the question itself — the app executes the filter over retrieved records.
 */
const Spec = z.object({
  status: z.enum(["active", "closed"]).nullable(),
  states: z.array(z.string().length(2)).nullable(),
  filedAfter: z.string().nullable().describe("YYYY-MM-DD"),
  filedBefore: z.string().nullable().describe("YYYY-MM-DD"),
  categories: z.array(z.enum(["civil", "criminal", "bankruptcy", "appeal"])).nullable(),
  matchTypes: z.array(z.enum(["party", "mention", "docket", "attorney", "possible_identity"])).nullable(),
  role: z.enum(["plaintiff", "defendant", "petitioner", "respondent", "debtor", "creditor", "appellant", "appellee"]).nullable(),
  courtText: z.string().nullable(),
  groupBy: z.enum(["attorney", "firm", "court", "judge"]).nullable(),
  unsupported: z.boolean().describe("True if the question cannot be expressed with these filters."),
});

export async function translateQuestion(question: string): Promise<AskSpec | null> {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const res = await client.beta.messages.parse({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: betaZodOutputFormat(Spec), effort: "low" },
    system:
      "Translate a user's question about a list of court records into filter parameters. Output only the filter. Use two-letter US state codes. Set unsupported=true if the question asks for anything the filters cannot express (opinions, predictions, facts about people).",
    messages: [{ role: "user", content: question.slice(0, 500) }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output || res.parsed_output.unsupported) return null;
  const p = res.parsed_output;
  const spec: AskSpec = {};
  if (p.status) spec.status = p.status;
  if (p.states?.length) spec.states = p.states.map((s) => s.toUpperCase());
  if (p.filedAfter && /^\d{4}-\d{2}-\d{2}$/.test(p.filedAfter)) spec.filedAfter = p.filedAfter;
  if (p.filedBefore && /^\d{4}-\d{2}-\d{2}$/.test(p.filedBefore)) spec.filedBefore = p.filedBefore;
  if (p.categories?.length) spec.categories = p.categories;
  if (p.matchTypes?.length) spec.matchTypes = p.matchTypes;
  if (p.role) spec.role = p.role;
  if (p.courtText) spec.courtText = p.courtText.slice(0, 40);
  if (p.groupBy) spec.groupBy = p.groupBy;
  return Object.keys(spec).length ? spec : null;
}
