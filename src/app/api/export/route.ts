import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { apiError, gateError, parseBody } from "@/lib/api/http";
import { SearchBodySchema } from "@/lib/api/schemas";
import { meterExport } from "@/lib/billing/entitlements";
import { searchForViewer } from "@/lib/search/service";
import { getPrimaryProvider } from "@/lib/providers/registry";
import { entriesToRows, EXPORT_ATTRIBUTION, hitsToRows, toCsv } from "@/lib/export/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("search"), format: z.enum(["csv", "json"]).default("csv"), search: SearchBodySchema, ids: z.array(z.string().max(300)).max(500).optional() }),
  z.object({ kind: z.literal("docket_entries"), format: z.enum(["csv", "json"]).default("csv"), docketId: z.string().regex(/^\d{1,12}$/), entryIds: z.array(z.string().max(60)).max(500).optional() }),
]);

function file(content: string, name: string, type: string) {
  return new Response(content, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const viewer = await getViewer();
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;
  const gate = await meterExport(viewer);
  if (!gate.allowed) return gateError(gate);
  const stamp = new Date().toISOString().slice(0, 10);

  if (body.data.kind === "search") {
    const result = await searchForViewer(viewer, body.data.search);
    const hits = body.data.ids?.length ? result.hits.filter((h) => body.data.kind === "search" && body.data.ids!.includes(h.id)) : result.hits;
    const rows = hitsToRows(hits);
    if (body.data.format === "json") return file(JSON.stringify({ attribution: EXPORT_ATTRIBUTION, dataMode: result.dataMode, exportedAt: new Date().toISOString(), coverage: result.coverage, records: rows }, null, 2), `search-${stamp}.json`, "application/json");
    return file(`# ${EXPORT_ATTRIBUTION}${result.dataMode === "demo" ? " DEMO SNAPSHOT — not live data." : ""}\n${toCsv(rows)}`, `search-${stamp}.csv`, "text/csv; charset=utf-8");
  }

  const res = await getPrimaryProvider().getDocket(body.data.docketId, { requestId: "export", userId: viewer.userId, plan: viewer.plan });
  if (!res.ok) return apiError(502, res.error.code, res.error.message);
  const entries = body.data.entryIds?.length ? res.data.entries.filter((e) => body.data.kind === "docket_entries" && body.data.entryIds!.includes(e.id)) : res.data.entries;
  const rows = entriesToRows(res.data.record.caseName, entries, res.data.record.sources[0]?.url ?? null);
  if (body.data.format === "json") return file(JSON.stringify({ attribution: EXPORT_ATTRIBUTION, exportedAt: new Date().toISOString(), record: res.data.record, entries: rows }, null, 2), `docket-${body.data.docketId}-${stamp}.json`, "application/json");
  return file(`# ${EXPORT_ATTRIBUTION}\n${toCsv(rows)}`, `docket-${body.data.docketId}-${stamp}.csv`, "text/csv; charset=utf-8");
}
