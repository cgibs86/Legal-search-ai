import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { features } from "@/lib/config/env";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { meterAiBrief, requireFeature } from "@/lib/billing/entitlements";
import { getPrimaryProvider } from "@/lib/providers/registry";
import { sourcesFromCase, sourcesFromDocket } from "@/lib/brief/sources";
import { BriefError, generateBrief } from "@/lib/brief/generate";
import type { DocumentText } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ kind: z.enum(["docket", "case"]), id: z.string().regex(/^\d{1,12}$/) });

export async function POST(req: Request) {
  const viewer = await getViewer();
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const feature = requireFeature(viewer, "aiCaseBrief");
  if (!feature.allowed) return gateError(feature);
  if (!features.ai()) return apiError(503, "not_configured", "AI Case Brief is not configured on this server (ANTHROPIC_API_KEY).");

  const provider = getPrimaryProvider();
  const ctx = { requestId: `brief-${body.data.id}`, userId: viewer.userId, plan: viewer.plan };
  const recordKey = `${body.data.kind}:${body.data.id}`;

  let sources;
  if (body.data.kind === "docket") {
    const d = await provider.getDocket(body.data.id, ctx);
    if (!d.ok) return apiError(502, d.error.code, d.error.message);
    // Include the complaint text when RECAP has it: it is the best source for "why was it filed".
    const extra: DocumentText[] = [];
    const complaint = [...d.data.entries].reverse().find((e) => e.category === "complaint" && e.documents.some((x) => x.available));
    const doc = complaint?.documents.find((x) => x.available);
    if (doc) {
      const t = await provider.getDocument(doc.id, ctx);
      if (t.ok && t.data.text) extra.push(t.data);
    }
    sources = sourcesFromDocket(d.data, extra);
  } else {
    const c = await provider.getCase(body.data.id, ctx);
    if (!c.ok) return apiError(502, c.error.code, c.error.message);
    sources = sourcesFromCase(c.data);
  }
  if (sources.length < 2) {
    return json({ brief: null, insufficient: true, message: "Insufficient source information: the source provides only basic metadata for this record." });
  }

  const gate = await meterAiBrief(viewer, recordKey);
  if (!gate.allowed) return gateError(gate);
  try {
    const { brief, cached } = await generateBrief(recordKey, sources);
    gate.commit();
    return json({ brief, cached, usage: { used: gate.used ?? null, limit: gate.limit ?? null } });
  } catch (e) {
    if (e instanceof BriefError) return apiError(e.code === "not_configured" ? 503 : e.code === "refused" ? 422 : 502, e.code, e.message);
    return apiError(500, "brief_failed", "Brief generation failed.");
  }
}
