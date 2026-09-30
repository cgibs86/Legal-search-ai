import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { log, errorMessage } from "@/lib/log";

/**
 * Server-side normalized cache keyed by provider + operation + query + filters + record type.
 * Uses Postgres (table `provider_cache`) when Supabase is configured so every serverless
 * instance shares hits; falls back to a bounded in-memory LRU otherwise.
 */

/** TTLs by record type. Freshness-sensitive data (docket activity) expires quickly. */
export const TTL_SECONDS = {
  docketSearch: 30 * 60,
  opinionSearch: 24 * 60 * 60,
  filingSearch: 6 * 60 * 60,
  docketDetail: 20 * 60,
  docketEntries: 15 * 60,
  parties: 12 * 60 * 60,
  opinionDetail: 7 * 24 * 60 * 60,
  document: 7 * 24 * 60 * 60,
  pacerSearch: 24 * 60 * 60,
} as const;

export type CacheBucket = keyof typeof TTL_SECONDS;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MAX_MEMORY_ENTRIES = 500;
const memory = new Map<string, Entry>();

function memoryGet(key: string): unknown | undefined {
  const e = memory.get(key);
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    memory.delete(key);
    return undefined;
  }
  memory.delete(key);
  memory.set(key, e);
  return e.value;
}

function memorySet(key: string, value: unknown, ttl: number) {
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
}

export function cacheKey(parts: { provider: string; op: string; bucket: CacheBucket; params: unknown }): string {
  const stable = JSON.stringify(parts.params, Object.keys(flatten(parts.params)).sort());
  const h = createHash("sha256").update(`${parts.provider}|${parts.op}|${parts.bucket}|${stable}`).digest("hex");
  return `${parts.provider}:${parts.bucket}:${h.slice(0, 40)}`;
}

function flatten(v: unknown, prefix = "", out: Record<string, true> = {}): Record<string, true> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = true;
      flatten(val, `${prefix}${k}.`, out);
    }
  }
  return out;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const hit = memoryGet(key);
  if (hit !== undefined) return hit as T;
  const db = getSupabaseAdmin();
  if (!db) return undefined;
  try {
    const { data, error } = await db
      .from("provider_cache")
      .select("value, expires_at")
      .eq("key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return undefined;
    const ttlLeft = Math.max(1, Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000));
    memorySet(key, data.value, Math.min(ttlLeft, 300));
    return data.value as T;
  } catch (e) {
    log.warn("cache.get_failed", { error: errorMessage(e) });
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown, bucket: CacheBucket): Promise<void> {
  const ttl = TTL_SECONDS[bucket];
  memorySet(key, value, ttl);
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("provider_cache").upsert({
      key,
      bucket,
      value,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    });
  } catch (e) {
    log.warn("cache.set_failed", { error: errorMessage(e) });
  }
}

export function clearMemoryCacheForTests() {
  memory.clear();
}
