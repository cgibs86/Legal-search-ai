import "server-only";
import { createHash } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getPlan } from "@/lib/config/plans";
import type { Viewer } from "@/lib/auth/session";

/**
 * Fixed-window rate limiting. Postgres-backed (shared across instances) when Supabase is
 * configured, in-memory otherwise. Anonymous visitors are keyed by a salted IP hash —
 * raw IPs are never stored.
 */

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

const memory = new Map<string, { windowStart: number; hits: number }>();

export function hashIp(ip: string | null): string {
  return createHash("sha256").update(`${ip ?? "unknown"}|${getEnv().IP_HASH_SALT}`).digest("hex").slice(0, 24);
}

export function clientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip");
}

export async function rateLimit(key: string, windowSeconds: number, max: number): Promise<RateResult> {
  const db = getSupabaseAdmin();
  if (db) {
    const { data, error } = await db.rpc("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      return { allowed: Boolean(row.allowed), remaining: Number(row.remaining), resetAt: String(row.reset_at) };
    }
  }
  const now = Date.now();
  const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
  const cur = memory.get(key);
  const hits = cur && cur.windowStart === windowStart ? cur.hits + 1 : 1;
  memory.set(key, { windowStart, hits });
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.windowStart < windowStart) memory.delete(k);
  }
  return { allowed: hits <= max, remaining: Math.max(0, max - hits), resetAt: new Date(windowStart + windowSeconds * 1000).toISOString() };
}

export const ANON_LIMITS = { perTenMinutes: 10, perDay: 40 };

/** Search rate limits: anonymous by IP hash, signed-in users by plan. */
export async function limitSearch(viewer: Viewer, headers: Headers): Promise<RateResult> {
  if (viewer.userId) {
    const perHour = getPlan(viewer.plan).limits.searchesPerHour;
    return rateLimit(`search:user:${viewer.userId}`, 3600, perHour);
  }
  const ip = hashIp(clientIp(headers));
  const short = await rateLimit(`search:ip10:${ip}`, 600, ANON_LIMITS.perTenMinutes);
  if (!short.allowed) return short;
  return rateLimit(`search:ipday:${ip}`, 86_400, ANON_LIMITS.perDay);
}

/** Cheap automated-traffic screen for public endpoints (headless tools, missing browser headers). */
export function looksAutomated(headers: Headers): boolean {
  const ua = headers.get("user-agent") ?? "";
  if (!ua || ua.length < 12) return true;
  return /(curl|wget|python-requests|httpx|scrapy|go-http-client|java\/|libwww|headlesschrome|phantomjs)/i.test(ua);
}
