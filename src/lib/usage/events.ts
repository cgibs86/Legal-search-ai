import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { log, errorMessage } from "@/lib/log";

/**
 * Operational usage events (provider calls, record views, briefs, exports).
 * Metering for plan limits reads these rows; admin metrics aggregate them.
 * Search text is never stored here.
 */
export type UsageKind =
  | "search"
  | "record_view"
  | "ai_brief"
  | "export"
  | "ask_results"
  | "provider_request"
  | "provider_error"
  | "pacer_spend"
  | "alert_sent";

export interface UsageEvent {
  kind: UsageKind;
  userId?: string | null;
  subjectKey?: string | null;
  provider?: string | null;
  status?: string | null;
  ms?: number | null;
  quantity?: number;
  props?: Record<string, unknown>;
}

const memoryEvents: (UsageEvent & { at: string })[] = [];

export function recordUsage(e: UsageEvent): void {
  const row = {
    kind: e.kind,
    user_id: e.userId ?? null,
    subject_key: e.subjectKey ?? null,
    provider: e.provider ?? null,
    status: e.status ?? null,
    ms: e.ms ?? null,
    quantity: e.quantity ?? 1,
    props: e.props ?? {},
  };
  const db = getSupabaseAdmin();
  if (!db) {
    memoryEvents.push({ ...e, at: new Date().toISOString() });
    if (memoryEvents.length > 5000) memoryEvents.splice(0, memoryEvents.length - 5000);
    return;
  }
  void db
    .from("usage_events")
    .insert(row)
    .then(({ error }) => {
      if (error) log.warn("usage.insert_failed", { kind: e.kind, error: error.message });
    }, (err: unknown) => log.warn("usage.insert_exception", { error: errorMessage(err) }));
}

/** Count of a user's events of a kind since a timestamp (optionally distinct by subject). */
export async function countUsage(userId: string, kind: UsageKind, sinceIso: string, distinctSubjects = false): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) {
    const rows = memoryEvents.filter((r) => r.userId === userId && r.kind === kind && r.at >= sinceIso);
    return distinctSubjects ? new Set(rows.map((r) => r.subjectKey)).size : rows.length;
  }
  if (distinctSubjects) {
    const { data, error } = await db.rpc("usage_distinct_subjects", { p_user: userId, p_kind: kind, p_since: sinceIso });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }
  const { count, error } = await db
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function hasUsageForSubject(userId: string, kind: UsageKind, subjectKey: string, sinceIso: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return memoryEvents.some((r) => r.userId === userId && r.kind === kind && r.subjectKey === subjectKey && r.at >= sinceIso);
  const { count } = await db
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("subject_key", subjectKey)
    .gte("created_at", sinceIso);
  return (count ?? 0) > 0;
}

export function memoryUsageSnapshot() {
  return memoryEvents.slice(-2000);
}

export function monthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
