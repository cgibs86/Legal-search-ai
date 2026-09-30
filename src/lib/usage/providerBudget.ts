import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { log, errorMessage } from "@/lib/log";

/**
 * Guards upstream quotas. CourtListener throttles on a rolling 24h window, so we track
 * requests in hourly buckets and refuse new live calls once the configured budget is
 * reached (the search then serves cache and reports the source as quota-limited).
 *
 * The same mechanism records PACER spend in cents, so paid traffic can never exceed the
 * server-side policy.
 */

interface Bucket {
  hour: number;
  count: number;
}

const memory = new Map<string, Bucket[]>();

function hourNow() {
  return Math.floor(Date.now() / 3_600_000);
}

function memoryTake(key: string, amount: number, limit: number, windowHours: number): { allowed: boolean; used: number } {
  const now = hourNow();
  const buckets = (memory.get(key) ?? []).filter((b) => b.hour > now - windowHours);
  const used = buckets.reduce((s, b) => s + b.count, 0);
  if (used + amount > limit) {
    memory.set(key, buckets);
    return { allowed: false, used };
  }
  const cur = buckets.find((b) => b.hour === now);
  if (cur) cur.count += amount;
  else buckets.push({ hour: now, count: amount });
  memory.set(key, buckets);
  return { allowed: true, used: used + amount };
}

function memoryUsed(key: string, windowHours: number): number {
  const now = hourNow();
  return (memory.get(key) ?? []).filter((b) => b.hour > now - windowHours).reduce((s, b) => s + b.count, 0);
}

/**
 * Atomically reserves `amount` units against `limit` over the trailing `windowHours`.
 * Uses the `budget_take` Postgres function when available (shared across instances).
 */
export async function takeBudget(key: string, amount: number, limit: number, windowHours = 24): Promise<{ allowed: boolean; used: number }> {
  const db = getSupabaseAdmin();
  if (db) {
    try {
      const { data, error } = await db.rpc("budget_take", {
        p_key: key,
        p_amount: amount,
        p_limit: limit,
        p_window_hours: windowHours,
      });
      if (!error && data && typeof data === "object") {
        const row = Array.isArray(data) ? data[0] : data;
        return { allowed: Boolean(row.allowed), used: Number(row.used) };
      }
      if (error) log.warn("budget.rpc_failed", { key, error: error.message });
    } catch (e) {
      log.warn("budget.rpc_exception", { key, error: errorMessage(e) });
    }
  }
  return memoryTake(key, amount, limit, windowHours);
}

export async function budgetUsed(key: string, windowHours = 24): Promise<number> {
  const db = getSupabaseAdmin();
  if (db) {
    try {
      const { data, error } = await db.rpc("budget_used", { p_key: key, p_window_hours: windowHours });
      if (!error && data != null) return Number(data);
    } catch {
      /* fall through */
    }
  }
  return memoryUsed(key, windowHours);
}

export function resetBudgetsForTests() {
  memory.clear();
}
