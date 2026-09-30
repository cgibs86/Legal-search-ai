import { getViewer, can } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { SearchBodySchema } from "@/lib/api/schemas";
import { requireFeature } from "@/lib/billing/entitlements";
import { searchForViewer } from "@/lib/search/service";
import { buildLitigationGraph } from "@/lib/graph/build";
import { InvalidSearchError } from "@/lib/search/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "litigationGraph");
  if (!gate.allowed) return gateError(gate);
  const body = await parseBody(req, SearchBodySchema);
  if (!body.ok) return body.response;
  try {
    const result = await searchForViewer(viewer, body.data);
    const graph = buildLitigationGraph(result.query, result.hits, { advanced: can(viewer, "advancedRelationshipAnalysis") });
    return json({ graph, dataMode: result.dataMode, hits: result.hits.map((h) => ({ id: h.id, caseName: h.record.caseName, court: h.record.court.citation ?? h.record.court.name, docketId: h.record.providerDocketId, dateFiled: h.record.dateFiled ?? h.record.opinions[0]?.dateFiled ?? null })) });
  } catch (e) {
    if (e instanceof InvalidSearchError) return apiError(400, "invalid_query", e.message);
    return apiError(500, "graph_failed", "Could not build the graph.");
  }
}
