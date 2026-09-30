import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import type { AnalyticsEvent } from "./events";

const memory: { name: string; anonId: string | null; userId: string | null; props: Record<string, unknown>; at: string }[] = [];

const SAFE_PROP = /^[a-z_]{1,40}$/;

/** Records a funnel event. Props are shallow-sanitized; search text must never be passed. */
export function trackEvent(name: AnalyticsEvent | string, opts: { userId?: string | null; anonId?: string | null; props?: Record<string, unknown> } = {}): void {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts.props ?? {})) {
    if (!SAFE_PROP.test(k)) continue;
    if (typeof v === "string") props[k] = v.slice(0, 80);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) props[k] = v;
  }
  const row = { name, anon_id: opts.anonId ?? null, user_id: opts.userId ?? null, props };
  const db = getSupabaseAdmin();
  if (!db) {
    memory.push({ name, anonId: row.anon_id, userId: row.user_id, props, at: new Date().toISOString() });
    if (memory.length > 5000) memory.splice(0, memory.length - 5000);
    return;
  }
  void db
    .from("analytics_events")
    .insert(row)
    .then(({ error }) => {
      if (error) log.warn("analytics.insert_failed", { event: name, error: error.message });
    });
}

export function memoryAnalyticsSnapshot() {
  return memory.slice();
}
