import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { requireFeature } from "@/lib/billing/entitlements";
import { getRepo } from "@/lib/data/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const key = z.string().min(3).max(300);
const Body = z.object({
  entityKey: key,
  recordKey: key,
  action: z.enum(["confirm", "reject", "move", "split", "merge"]),
  targetClusterId: key.nullish(),
  sourceClusterId: key.nullish(),
});

export async function POST(req: Request) {
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "identityResolution");
  if (!gate.allowed) return gateError(gate);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in to save identity corrections.");
  if ((body.data.action === "move" || body.data.action === "merge") && !body.data.targetClusterId) return apiError(400, "invalid_request", "A target group is required.");
  const correction = await repo.addCorrection({
    entityKey: body.data.entityKey,
    recordKey: body.data.recordKey,
    action: body.data.action,
    targetClusterId: body.data.targetClusterId ?? null,
    sourceClusterId: body.data.sourceClusterId ?? null,
  });
  return json({ correction });
}

export async function DELETE(req: Request) {
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "identityResolution");
  if (!gate.allowed) return gateError(gate);
  const entityKey = new URL(req.url).searchParams.get("entityKey");
  if (!entityKey || entityKey.length > 300) return apiError(400, "invalid_request", "entityKey is required.");
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  await repo.clearCorrections(entityKey);
  return json({ ok: true });
}
