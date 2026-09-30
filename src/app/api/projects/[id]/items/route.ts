import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { requireFeature } from "@/lib/billing/entitlements";
import { getRepo } from "@/lib/data/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

const Item = z.object({
  kind: z.enum(["entity", "case", "docket", "filing", "note", "ai_summary", "timeline_item", "graph_view", "search"]),
  title: z.string().trim().min(1).max(300),
  ref: z.record(z.string(), z.unknown()).default({}),
  note: z.string().max(10_000).nullish(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError(400, "invalid_id", "Invalid project id.");
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "researchWorkspaces");
  if (!gate.allowed) return gateError(gate);
  const body = await parseBody(req, Item);
  if (!body.ok) return body.response;
  if (JSON.stringify(body.data.ref).length > 60_000) return apiError(413, "too_large", "Saved item is too large.");
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  try {
    const item = await repo.addProjectItem(id, body.data);
    return json({ item }, { status: 201 });
  } catch {
    return apiError(404, "not_found", "Project not found or not editable.");
  }
}

const Patch = z.object({ itemId: z.string().regex(UUID), note: z.string().max(10_000).nullish(), title: z.string().trim().min(1).max(300).optional() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const body = await parseBody(req, Patch);
  if (!body.ok) return body.response;
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  await repo.updateProjectItem(id, body.data.itemId, { note: body.data.note ?? null, ...(body.data.title ? { title: body.data.title } : {}) });
  return json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const itemId = new URL(req.url).searchParams.get("itemId") ?? "";
  if (!UUID.test(id) || !UUID.test(itemId)) return apiError(400, "invalid_id", "Invalid id.");
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  await repo.removeProjectItem(id, itemId);
  return json({ ok: true });
}
