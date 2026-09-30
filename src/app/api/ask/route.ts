import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { SearchBodySchema } from "@/lib/api/schemas";
import { requireFeature } from "@/lib/billing/entitlements";
import { searchForViewer } from "@/lib/search/service";
import { executeAsk, parseQuestion } from "@/lib/ask/parse";
import { translateQuestion } from "@/lib/ask/ai";
import { rateLimit } from "@/lib/security/ratelimit";
import { recordUsage } from "@/lib/usage/events";
import { InvalidSearchError } from "@/lib/search/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = SearchBodySchema.extend({ question: z.string().min(3).max(300) });

export async function POST(req: Request) {
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "askResults");
  if (!gate.allowed) return gateError(gate);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const rl = await rateLimit(`ask:${viewer.userId}`, 3600, 120);
  if (!rl.allowed) return apiError(429, "rate_limited", "Too many questions this hour.", { resetAt: rl.resetAt });
  try {
    const result = await searchForViewer(viewer, body.data);
    let { spec, understood } = parseQuestion(body.data.question);
    let usedAI = false;
    if (!understood) {
      const aiSpec = await translateQuestion(body.data.question).catch(() => null);
      if (aiSpec) {
        spec = aiSpec;
        understood = true;
        usedAI = true;
      }
    }
    recordUsage({ kind: "ask_results", userId: viewer.userId, props: { usedAI, understood } });
    if (!understood) {
      return json({
        answer: {
          interpretation: [],
          matchingIds: [],
          groups: [],
          answer: "I can filter these results by status, state, filing dates, case type, match type, party role, court, or group them by attorney, firm, judge or court. Try: “Which of these cases are still active?”",
          notes: [],
          understood: false,
          usedAI: false,
        },
      });
    }
    return json({ answer: executeAsk(result.hits, spec, usedAI) });
  } catch (e) {
    if (e instanceof InvalidSearchError) return apiError(400, "invalid_query", e.message);
    return apiError(500, "ask_failed", "Could not answer that question.");
  }
}
