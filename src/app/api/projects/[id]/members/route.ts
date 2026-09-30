import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, json, parseBody } from "@/lib/api/http";
import { addMember, listMembers, MemberError, removeMember } from "@/lib/data/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

function fail(e: unknown) {
  if (e instanceof MemberError) {
    const status = { not_supported: 501, forbidden: 403, not_found: 404, seat_limit: 402, exists: 409, invalid: 400 }[e.code];
    return apiError(status, e.code, e.message);
  }
  return apiError(500, "members_failed", "Could not update sharing.");
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError(400, "invalid_id", "Invalid project id.");
  const viewer = await getViewer();
  if (!viewer.userId) return apiError(401, "sign_in", "Sign in to continue.");
  try {
    return json({ members: await listMembers(viewer, id) });
  } catch (e) {
    return fail(e);
  }
}

const Add = z.object({ email: z.string().trim().email().max(320), role: z.enum(["editor", "viewer"]).default("viewer") });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError(400, "invalid_id", "Invalid project id.");
  const viewer = await getViewer();
  if (!viewer.userId) return apiError(401, "sign_in", "Sign in to continue.");
  const body = await parseBody(req, Add);
  if (!body.ok) return body.response;
  try {
    return json({ member: await addMember(viewer, id, body.data.email, body.data.role) }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

const Remove = z.object({ userId: z.string().regex(UUID) });

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError(400, "invalid_id", "Invalid project id.");
  const viewer = await getViewer();
  if (!viewer.userId) return apiError(401, "sign_in", "Sign in to continue.");
  const body = await parseBody(req, Remove);
  if (!body.ok) return body.response;
  try {
    await removeMember(viewer, id, body.data.userId);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
