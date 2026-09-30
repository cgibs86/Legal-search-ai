import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { checkCount, requireFeature } from "@/lib/billing/entitlements";
import { getRepo } from "@/lib/data/repo";
import { trackEvent } from "@/lib/analytics/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in to view projects.");
  return json({ projects: await repo.listProjects() });
}

const Create = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullish() });

export async function POST(req: Request) {
  const viewer = await getViewer();
  const feature = requireFeature(viewer, "researchWorkspaces");
  if (!feature.allowed) return gateError(feature);
  const body = await parseBody(req, Create);
  if (!body.ok) return body.response;
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  const existing = await repo.listProjects();
  const gate = checkCount(viewer, existing.filter((p) => p.role === "owner").length, "projects", "research projects");
  if (!gate.allowed) return gateError(gate);
  const project = await repo.createProject(body.data);
  if (existing.length === 0) trackEvent("first_project_created", { userId: viewer.userId });
  return json({ project }, { status: 201 });
}
