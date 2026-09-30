import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Gate } from "@/lib/billing/entitlements";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export interface ApiErrorBody {
  error: { code: string; message: string; requiredPlan?: string; resetAt?: string; used?: number; limit?: number };
}

export function apiError(status: number, code: string, message: string, extra: Partial<ApiErrorBody["error"]> = {}) {
  return json<ApiErrorBody>({ error: { code, message, ...extra } }, { status });
}

export function gateError(g: Exclude<Gate, { allowed: true }>) {
  const status = g.reason === "sign_in" ? 401 : g.reason === "limit" ? 429 : 402;
  return apiError(status, g.reason, g.message, { requiredPlan: g.requiredPlan, used: g.used, limit: g.limit });
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 100_000) return { ok: false, response: apiError(413, "too_large", "Request body too large.") };
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must be JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: apiError(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).slice(0, 3).join("; ")) };
  }
  return { ok: true, data: parsed.data };
}

export const ANON_COOKIE = "lsa_aid";

export function anonIdFrom(req: Request): { id: string; isNew: boolean } {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)lsa_aid=([a-f0-9-]{36})/);
  return m ? { id: m[1], isNew: false } : { id: randomUUID(), isNew: true };
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}
