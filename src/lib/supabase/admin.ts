import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { features, getEnv } from "@/lib/config/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client for trusted server work (webhooks, cron, caches, admin metrics).
 * Never import this from a client component; never use it to answer a user request
 * without scoping queries to that user explicitly.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!features.supabaseAdmin()) return null;
  if (!admin) {
    const env = getEnv();
    admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
