import { z } from "zod";
import { getViewer, can } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { FiltersSchema, EntityTypeSchema } from "@/lib/api/schemas";
import { checkCount } from "@/lib/billing/entitlements";
import { getRepo } from "@/lib/data/repo";
import { getPrimaryProvider } from "@/lib/providers/registry";
import { trackEvent } from "@/lib/analytics/track";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in to use Case Radar.");
  return json({ watchlists: await repo.listWatchlists() });
}

const Create = z.object({
  kind: z.enum(["person", "company", "case", "docket", "attorney", "law_firm", "search"]),
  label: z.string().trim().min(1).max(200),
  query: z.object({
    query: z.string().min(2).max(200).optional(),
    entityType: EntityTypeSchema.optional(),
    filters: FiltersSchema.optional(),
    docketId: z.string().regex(/^\d{1,12}$/).optional(),
    recordKey: z.string().max(300).optional(),
  }),
  frequency: z.enum(["immediate", "daily", "weekly"]).default("daily"),
  channels: z.object({ email: z.boolean(), in_app: z.boolean() }).default({ email: true, in_app: true }),
});

export async function POST(req: Request) {
  const viewer = await getViewer();
  const body = await parseBody(req, Create);
  if (!body.ok) return body.response;
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Create an account to monitor records.");
  if (body.data.kind === "docket" && !body.data.query.docketId) return apiError(400, "invalid_request", "Docket watches need a docketId.");
  if (body.data.kind !== "docket" && !body.data.query.query) return apiError(400, "invalid_request", "Entity watches need a query.");
  if (body.data.frequency === "immediate" && !can(viewer, "advancedMonitoring") && !can(viewer, "docketDiff")) {
    return apiError(402, "upgrade", "Immediate alerts are available on Research Pro and higher.", { requiredPlan: "research_pro" });
  }
  const active = await repo.countActiveWatchlists();
  const gate = checkCount(viewer, active, "activeAlerts", "active alerts");
  if (!gate.allowed) return gateError(gate);
  const watch = await repo.createWatchlist({ ...body.data, query: { ...body.data.query, provider: "courtlistener" } });
  if (active === 0) trackEvent("first_alert_created", { userId: viewer.userId, props: { kind: body.data.kind } });

  // Optional: register a provider-side monitor so updates can arrive by webhook.
  const monitor = await getPrimaryProvider().createMonitor(
    body.data.kind === "docket"
      ? { kind: "docket", name: body.data.label, target: body.data.query.docketId! }
      : { kind: "search", name: body.data.label, target: new URLSearchParams({ q: `"${body.data.query.query}"`, type: "d" }).toString() },
    { requestId: `monitor-${watch.id}`, userId: viewer.userId, plan: viewer.plan },
  );
  const admin = getSupabaseAdmin();
  if (monitor.ok && admin && !viewer.demo) await admin.from("watchlists").update({ provider_monitor_id: monitor.data.providerMonitorId }).eq("id", watch.id);
  return json({ watch, providerMonitor: monitor.ok ? monitor.data : null }, { status: 201 });
}

const Patch = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  frequency: z.enum(["immediate", "daily", "weekly"]).optional(),
  channels: z.object({ email: z.boolean(), in_app: z.boolean() }).optional(),
  active: z.boolean().optional(),
  label: z.string().trim().min(1).max(200).optional(),
});

export async function PATCH(req: Request) {
  const viewer = await getViewer();
  const body = await parseBody(req, Patch);
  if (!body.ok) return body.response;
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  if (body.data.active === true) {
    const gate = checkCount(viewer, await repo.countActiveWatchlists(), "activeAlerts", "active alerts");
    if (!gate.allowed) return gateError(gate);
  }
  const { id, ...patch } = body.data;
  await repo.updateWatchlist(id, patch);
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return apiError(400, "invalid_id", "Invalid id.");
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  await repo.deleteWatchlist(id);
  return json({ ok: true });
}
