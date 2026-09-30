import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { EntityTypeSchema, FiltersSchema } from "@/lib/api/schemas";
import { checkCount } from "@/lib/billing/entitlements";
import { getRepo } from "@/lib/data/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in to see saved searches.");
  return json({ searches: await repo.listSavedSearches() });
}

const Create = z.object({ name: z.string().trim().min(1).max(120), query: z.string().min(2).max(200), entityType: EntityTypeSchema, filters: FiltersSchema.default({}) });

export async function POST(req: Request) {
  const viewer = await getViewer();
  const body = await parseBody(req, Create);
  if (!body.ok) return body.response;
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Create an account to save searches.");
  const gate = checkCount(viewer, (await repo.listSavedSearches()).length, "savedSearches", "saved searches");
  if (!gate.allowed) return gateError(gate);
  return json({ search: await repo.saveSearch(body.data) }, { status: 201 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return apiError(400, "invalid_id", "Invalid id.");
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  await repo.deleteSavedSearch(id);
  return json({ ok: true });
}
