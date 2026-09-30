import "server-only";
import type { z } from "zod";
import { getEnv } from "@/lib/config/env";
import { cacheGet, cacheKey, cacheSet, type CacheBucket } from "@/lib/cache/store";
import { takeBudget } from "@/lib/usage/providerBudget";
import { recordUsage } from "@/lib/usage/events";
import { log, errorMessage } from "@/lib/log";
import type { ProviderContext, ProviderError, ProviderResult } from "@/lib/providers/types";

export const CL_BUDGET_KEY = "courtlistener:requests";

export type ClFetcher = <S extends z.ZodTypeAny>(opts: FetchOptions<S>) => Promise<ProviderResult<z.infer<S>>>;

export interface FetchOptions<S extends z.ZodTypeAny> {
  path: string;
  params?: URLSearchParams;
  schema: S;
  bucket: CacheBucket;
  ctx: ProviderContext;
  method?: "GET" | "POST" | "DELETE";
  body?: URLSearchParams;
  /** Skip the shared cache (writes, monitors). */
  noCache?: boolean;
}

function parseRetryAfter(detail: string | undefined, header: string | null): number | undefined {
  const h = header ? Number(header) : NaN;
  if (!Number.isNaN(h)) return h;
  const m = detail?.match(/available in (\d+) seconds/i);
  return m ? Number(m[1]) : undefined;
}

/**
 * The single place that talks to CourtListener. Enforces: server-only token, request
 * budget, timeout, cache, runtime validation and structured error mapping.
 */
export async function clFetch<S extends z.ZodTypeAny>(opts: FetchOptions<S>): Promise<ProviderResult<z.infer<S>>> {
  const env = getEnv();
  const started = Date.now();
  const token = env.COURTLISTENER_API_TOKEN;
  if (!token) {
    return { ok: false, error: { code: "not_configured", message: "COURTLISTENER_API_TOKEN is not set." }, meta: { requests: 0, cached: false, ms: 0 } };
  }
  const method = opts.method ?? "GET";
  const key = cacheKey({ provider: "courtlistener", op: `${method} ${opts.path}`, bucket: opts.bucket, params: Object.fromEntries(opts.params ?? []) });

  if (method === "GET" && !opts.noCache) {
    const hit = await cacheGet<z.infer<S>>(key);
    if (hit !== undefined) return { ok: true, data: hit, meta: { requests: 0, cached: true, ms: Date.now() - started } };
  }

  const budget = await takeBudget(CL_BUDGET_KEY, 1, env.COURTLISTENER_DAILY_REQUEST_BUDGET);
  if (!budget.allowed) {
    recordUsage({ kind: "provider_error", provider: "courtlistener", status: "budget_exhausted" });
    return {
      ok: false,
      error: { code: "quota", message: `Daily CourtListener request budget (${env.COURTLISTENER_DAILY_REQUEST_BUDGET}) reached. Serving cached results only.` },
      meta: { requests: 0, cached: false, ms: Date.now() - started },
    };
  }

  const url = `${env.COURTLISTENER_BASE_URL.replace(/\/$/, "")}/${opts.path.replace(/^\//, "")}${opts.params && method === "GET" ? `?${opts.params.toString()}` : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.COURTLISTENER_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.ctx.signal?.addEventListener("abort", onAbort);

  let error: ProviderError | null = null;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/json",
        "User-Agent": `LegalSearchAI/1.0 (+${env.NEXT_PUBLIC_SITE_URL})`,
        ...(opts.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: opts.body?.toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const detail = json && typeof json === "object" && "detail" in json ? String((json as { detail: unknown }).detail) : undefined;

    if (!res.ok) {
      if (res.status === 429) error = { code: "quota", message: detail ?? "CourtListener rate limit reached.", retryAfterSeconds: parseRetryAfter(detail, res.headers.get("retry-after")) };
      else if (res.status === 401) error = { code: "auth", message: "CourtListener rejected the API token." };
      else if (res.status === 403) error = { code: "auth", message: detail ?? "This CourtListener endpoint is not available to the configured account." };
      else if (res.status === 404) error = { code: "not_found", message: "Record not found at CourtListener." };
      else if (res.status === 400) error = { code: "bad_request", message: detail ?? "CourtListener could not parse this query." };
      else error = { code: "upstream", message: `CourtListener returned HTTP ${res.status}.` };
      recordUsage({ kind: "provider_error", provider: "courtlistener", status: error.code, ms, props: { path: opts.path, http: res.status } });
      log.warn("courtlistener.error", { path: opts.path, http: res.status, code: error.code, requestId: opts.ctx.requestId });
      return { ok: false, error, meta: { requests: 1, cached: false, ms } };
    }

    recordUsage({ kind: "provider_request", provider: "courtlistener", status: "ok", ms, props: { path: opts.path } });
    if (method === "DELETE") return { ok: true, data: null as z.infer<S>, meta: { requests: 1, cached: false, ms } };

    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      log.error("courtlistener.schema_mismatch", { path: opts.path, issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
      recordUsage({ kind: "provider_error", provider: "courtlistener", status: "schema_mismatch", ms, props: { path: opts.path } });
      return { ok: false, error: { code: "upstream", message: "CourtListener returned data in an unexpected format." }, meta: { requests: 1, cached: false, ms } };
    }
    if (method === "GET" && !opts.noCache) await cacheSet(key, parsed.data, opts.bucket);
    return { ok: true, data: parsed.data, meta: { requests: 1, cached: false, ms } };
  } catch (e) {
    const ms = Date.now() - started;
    const aborted = controller.signal.aborted;
    error = aborted
      ? { code: "timeout", message: `CourtListener did not respond within ${Math.round(env.COURTLISTENER_TIMEOUT_MS / 1000)}s.` }
      : { code: "network", message: "Could not reach CourtListener." };
    recordUsage({ kind: "provider_error", provider: "courtlistener", status: error.code, ms, props: { path: opts.path } });
    log.warn("courtlistener.fetch_failed", { path: opts.path, code: error.code, error: errorMessage(e), requestId: opts.ctx.requestId });
    return { ok: false, error, meta: { requests: 1, cached: false, ms } };
  } finally {
    clearTimeout(timer);
    opts.ctx.signal?.removeEventListener("abort", onAbort);
  }
}
