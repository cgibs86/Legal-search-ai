import { getViewer } from "@/lib/auth/session";
import { apiError, json } from "@/lib/api/http";
import { getRepo } from "@/lib/data/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError(400, "invalid_id", "Invalid project id.");
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  const project = await repo.getProject(id);
  if (!project) return apiError(404, "not_found", "Project not found.");
  return json(project);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError(400, "invalid_id", "Invalid project id.");
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  await repo.deleteProject(id);
  return json({ ok: true });
}
