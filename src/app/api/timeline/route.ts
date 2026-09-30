import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { SearchBodySchema } from "@/lib/api/schemas";
import { requireFeature } from "@/lib/billing/entitlements";
import { searchForViewer } from "@/lib/search/service";
import { buildEntityTimeline } from "@/lib/timeline/build";
import { InvalidSearchError } from "@/lib/search/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "entityTimeline");
  if (!gate.allowed) return gateError(gate);
  const body = await parseBody(req, SearchBodySchema);
  if (!body.ok) return body.response;
  try {
    const result = await searchForViewer(viewer, body.data);
    return json({ timeline: buildEntityTimeline(result.hits), dataMode: result.dataMode });
  } catch (e) {
    if (e instanceof InvalidSearchError) return apiError(400, "invalid_query", e.message);
    return apiError(500, "timeline_failed", "Could not build the timeline.");
  }
}
