import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { features, getEnv } from "@/lib/config/env";

/**
 * Per-request Supabase client bound to the user's auth cookies. RLS applies to every
 * query made with it. Returns null when Supabase is not configured.
 */
export async function createSupabaseServer(): Promise<SupabaseClient | null> {
  if (!features.supabase()) return null;
  const env = getEnv();
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session cookie instead.
        }
      },
    },
  });
}
