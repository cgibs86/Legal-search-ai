import "server-only";
import type { Viewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Shared workspaces (Intelligence): a project owner can add up to `seats - 1` people by
 * the email they signed up with. Access is enforced by RLS (`is_project_member`); the
 * service role is used only to resolve emails, which profiles RLS keeps private.
 */

export interface Member {
  userId: string;
  email: string | null;
  role: "owner" | "editor" | "viewer";
}

export class MemberError extends Error {
  constructor(
    public code: "not_supported" | "forbidden" | "not_found" | "seat_limit" | "exists" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

async function ownerProject(viewer: Viewer, projectId: string) {
  const db = await createSupabaseServer();
  if (!db || viewer.demo || !viewer.userId) throw new MemberError("not_supported", "Shared workspaces need a real account (Supabase). The demo workspace is single-user.");
  const { data: p } = await db.from("projects").select("id, owner_id").eq("id", projectId).maybeSingle();
  if (!p) throw new MemberError("not_found", "Project not found.");
  return { db, isOwner: p.owner_id === viewer.userId };
}

export async function listMembers(viewer: Viewer, projectId: string): Promise<Member[]> {
  const { db } = await ownerProject(viewer, projectId);
  const { data: rows } = await db.from("project_members").select("user_id, role").eq("project_id", projectId);
  const ids = (rows ?? []).map((r) => r.user_id as string);
  const admin = getSupabaseAdmin();
  const { data: profiles } = admin && ids.length ? await admin.from("profiles").select("id, email").in("id", ids) : { data: [] as { id: string; email: string | null }[] };
  return (rows ?? []).map((r) => ({ userId: r.user_id as string, role: r.role as Member["role"], email: (profiles ?? []).find((p) => p.id === r.user_id)?.email ?? null }));
}

export async function addMember(viewer: Viewer, projectId: string, email: string, role: "editor" | "viewer"): Promise<Member> {
  if (!can(viewer, "collaboration")) throw new MemberError("forbidden", "Shared workspaces are included in Intelligence.");
  const { db, isOwner } = await ownerProject(viewer, projectId);
  if (!isOwner) throw new MemberError("forbidden", "Only the project owner can add people.");
  const admin = getSupabaseAdmin();
  if (!admin) throw new MemberError("not_supported", "SUPABASE_SERVICE_ROLE_KEY is required to look up accounts by email.");
  const seats = getPlan(viewer.plan).limits.seats;
  const { count } = await db.from("project_members").select("user_id", { count: "exact", head: true }).eq("project_id", projectId);
  if ((count ?? 0) >= seats) throw new MemberError("seat_limit", `Your plan includes ${seats} seats per workspace, including you.`);
  const normalized = email.trim().toLowerCase();
  const { data: profile } = await admin.from("profiles").select("id, email").eq("email", normalized).maybeSingle(); // exact match: ilike would treat % and _ in input as wildcards
  // Same response whether or not the email exists would be ideal for privacy, but the owner
  // needs to know the invite did not land; we only reveal "no account", never account details.
  if (!profile) throw new MemberError("not_found", "No account uses that email yet. Ask them to sign up first, then add them.");
  if (profile.id === viewer.userId) throw new MemberError("exists", "You already own this project.");
  const { error } = await db.from("project_members").insert({ project_id: projectId, user_id: profile.id, role });
  if (error) throw new MemberError(error.code === "23505" ? "exists" : "invalid", error.code === "23505" ? "That person already has access." : "Could not add that person.");
  return { userId: profile.id, email: profile.email, role };
}

export async function removeMember(viewer: Viewer, projectId: string, userId: string): Promise<void> {
  const { db, isOwner } = await ownerProject(viewer, projectId);
  // Owners can remove anyone but themselves; members can remove themselves (leave).
  if (!isOwner && userId !== viewer.userId) throw new MemberError("forbidden", "Only the project owner can remove people.");
  if (isOwner && userId === viewer.userId) throw new MemberError("invalid", "Owners can't leave their own project. Delete it instead.");
  const client = isOwner ? db : getSupabaseAdmin();
  if (!client) throw new MemberError("not_supported", "Not configured.");
  await client.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId);
}
