import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { runRadar } from "@/lib/radar/runner";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Case Radar scheduler entry point (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const report = await runRadar();
  await getSupabaseAdmin()?.rpc("purge_expired_cache");
  return Response.json({ ok: true, report });
}
