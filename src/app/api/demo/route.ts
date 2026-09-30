import { z } from "zod";
import { features, resolveDataMode } from "@/lib/config/env";
import { apiError, json, parseBody } from "@/lib/api/http";
import { randomUUID } from "node:crypto";
import { DEMO_COOKIE, DEMO_ID_COOKIE } from "@/lib/auth/session";
import { readCookie } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ plan: z.enum(["free", "search", "research_pro", "intelligence"]) });

/**
 * Demo workspace: only available when authentication is NOT configured and the app is in
 * demo data mode. Lets reviewers explore paid features on labeled fixture data.
 */
export async function POST(req: Request) {
  if (features.supabase() || resolveDataMode() !== "demo") return apiError(404, "not_available", "The demo workspace is disabled on this deployment.");
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const res = json({ ok: true, plan: body.data.plan });
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 };
  res.cookies.set(DEMO_COOKIE, body.data.plan, opts);
  // Keep the same private workspace when switching plans; mint one on first entry.
  const existing = readCookie(req, DEMO_ID_COOKIE);
  res.cookies.set(DEMO_ID_COOKIE, existing && /^[0-9a-f-]{36}$/.test(existing) ? existing : randomUUID(), opts);
  return res;
}

export async function DELETE() {
  const res = json({ ok: true });
  res.cookies.set(DEMO_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  res.cookies.set(DEMO_ID_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
