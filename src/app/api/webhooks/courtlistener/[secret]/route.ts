import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CourtListener webhook source IPs (per CourtListener's webhook documentation). */
const CL_IPS = new Set(["34.210.230.218", "54.189.59.91"]);

function secretMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Receives CourtListener docket/search alert webhooks (requires a CourtListener commercial
 * agreement). CourtListener does not sign webhooks, so we use a long secret URL, an optional
 * source-IP check and the Idempotency-Key header. Events only mark matching watchlists as
 * due; the Case Radar runner then fetches and diffs the docket itself.
 */
export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const env = getEnv();
  const { secret } = await ctx.params;
  if (!env.COURTLISTENER_WEBHOOKS_ENABLED || !secretMatches(secret, env.COURTLISTENER_WEBHOOK_SECRET)) return new Response("Not found", { status: 404 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (env.COURTLISTENER_WEBHOOK_ENFORCE_IPS && !CL_IPS.has(ip)) return new Response("Forbidden", { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return new Response("Not configured", { status: 503 });

  const key = req.headers.get("idempotency-key");
  if (key) {
    const { error } = await db.from("webhook_receipts").insert({ idempotency_key: key, source: "courtlistener" });
    if (error?.code === "23505") return new Response("Duplicate", { status: 200 });
  }
  const payload = (await req.json().catch(() => null)) as { webhook?: { event_type?: number }; payload?: { results?: { docket?: number }[]; alert?: { id?: number } } } | null;
  const type = payload?.webhook?.event_type;
  let monitorIds: string[] = [];
  if (type === 1) monitorIds = [...new Set((payload?.payload?.results ?? []).map((r) => r.docket).filter(Boolean))].map((d) => `docket-alert-docket:${d}`);
  if (type === 2 && payload?.payload?.alert?.id) monitorIds = [`search-alert:${payload.payload.alert.id}`];

  if (type === 1) {
    const dockets = (payload?.payload?.results ?? []).map((r) => String(r.docket)).filter(Boolean);
    if (dockets.length) await db.from("watchlists").update({ last_checked_at: null }).eq("kind", "docket").in("query->>docketId", dockets);
  } else if (monitorIds.length) {
    await db.from("watchlists").update({ last_checked_at: null }).in("provider_monitor_id", monitorIds);
  }
  log.info("courtlistener.webhook", { type, monitors: monitorIds.length });
  return new Response("OK", { status: 200 });
}
