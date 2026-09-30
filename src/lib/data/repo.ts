import "server-only";
import type { Viewer } from "@/lib/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { memoryRepo } from "./memoryRepo";
import { supabaseRepo } from "./supabaseRepo";
import type { WorkspaceRepo } from "./types";

/** Returns the workspace repository for a signed-in (or demo) viewer, or null for anonymous visitors. */
export async function getRepo(viewer: Viewer): Promise<WorkspaceRepo | null> {
  if (!viewer.userId) return null;
  if (viewer.demo) return memoryRepo(viewer.userId);
  const db = await createSupabaseServer();
  if (!db) return null;
  return supabaseRepo(db, viewer.userId);
}

export type { WorkspaceRepo };
