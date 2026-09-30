import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, json, parseBody } from "@/lib/api/http";
import { getRepo } from "@/lib/data/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in to view alerts.");
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  return json({ alerts: await repo.listAlerts({ unreadOnly, limit: 100 }), unread: await repo.unreadAlertCount() });
}

const Body = z.union([z.object({ id: z.string().regex(/^[0-9a-f-]{36}$/) }), z.object({ all: z.literal(true) })]);

export async function POST(req: Request) {
  const viewer = await getViewer();
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const repo = await getRepo(viewer);
  if (!repo) return apiError(401, "sign_in", "Sign in first.");
  if ("all" in body.data) await repo.markAllAlertsRead();
  else await repo.markAlertRead(body.data.id);
  return json({ ok: true, unread: await repo.unreadAlertCount() });
}
