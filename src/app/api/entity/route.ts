import { can, getViewer } from "@/lib/auth/session";
import { apiError, gateError, json, parseBody } from "@/lib/api/http";
import { SearchBodySchema } from "@/lib/api/schemas";
import { requireFeature } from "@/lib/billing/entitlements";
import { identityFor, searchForViewer } from "@/lib/search/service";
import { InvalidSearchError, type InternalSearchResult } from "@/lib/search/orchestrator";
import { buildEntityProfile } from "@/lib/entity/profile";
import { buildLitigationGraph } from "@/lib/graph/build";
import { getRepo } from "@/lib/data/repo";
import { normalizeName } from "@/lib/text/names";
import { log, errorMessage } from "@/lib/log";
import type { SearchHit } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pages of results an entity profile is built from. Deeper retrieval is an Intelligence feature. */
const PAGES = { standard: 1, advanced: 3 } as const;

export async function POST(req: Request) {
  const viewer = await getViewer();
  const gate = requireFeature(viewer, "docketDetails");
  if (!gate.allowed) return gateError(gate);
  const body = await parseBody(req, SearchBodySchema);
  if (!body.ok) return body.response;
  const advanced = can(viewer, "advancedEntityProfiles");

  try {
    const first = await searchForViewer(viewer, { ...body.data, pageToken: null });
    const hits: SearchHit[] = [...first.hits];
    let next = first.nextPageToken;
    let pages = 1;
    let last: InternalSearchResult = first;
    while (next && pages < (advanced ? PAGES.advanced : PAGES.standard)) {
      last = await searchForViewer(viewer, { ...body.data, pageToken: next });
      for (const h of last.hits) if (!hits.some((x) => x.id === h.id)) hits.push(h);
      next = last.nextPageToken;
      pages += 1;
    }

    const profile = buildEntityProfile({ query: first.query, entityType: first.entityType, variants: first.variants, hits });
    const mentionsAllowed = can(viewer, "mentionIntelligence");
    if (!mentionsAllowed) profile.documents = profile.documents.map((d) => ({ ...d, snippet: null }));

    const insights = can(viewer, "litigationGraph") ? buildLitigationGraph(first.query, hits, { advanced }).insights.slice(0, advanced ? 12 : 5) : null;
    const identity = await identityFor(viewer, { ...first, hits });
    const identitySummary = {
      locked: !can(viewer, "identityResolution"),
      clusters: identity.clusters.length,
      byConfidence: identity.clusters.reduce<Record<string, number>>((acc, c) => ((acc[c.confidence] = (acc[c.confidence] ?? 0) + 1), acc), {}),
    };

    // Monitoring and saved research that already reference this name.
    const repo = await getRepo(viewer);
    const key = normalizeName(first.query);
    let watches: { id: string; label: string; frequency: string; active: boolean }[] = [];
    let saved: { projectId: string; projectName: string; itemId: string; title: string; kind: string }[] = [];
    if (repo) {
      const [w, projects] = await Promise.all([repo.listWatchlists(), repo.listProjects()]);
      watches = w.filter((x) => x.query.query && normalizeName(x.query.query) === key).map((x) => ({ id: x.id, label: x.label, frequency: x.frequency, active: x.active }));
      const hitKeys = new Set(hits.map((h) => h.record.key));
      const details = await Promise.all(projects.slice(0, 25).map((p) => repo.getProject(p.id)));
      saved = details.flatMap((d) =>
        d
          ? d.items
              .filter((it) => (typeof it.ref.query === "string" && normalizeName(it.ref.query) === key) || (typeof it.ref.recordKey === "string" && hitKeys.has(it.ref.recordKey)))
              .map((it) => ({ projectId: d.project.id, projectName: d.project.name, itemId: it.id, title: it.title, kind: it.kind }))
          : [],
      );
    }

    return json({
      profile,
      hits: mentionsAllowed ? hits : hits.map((h) => ({ ...h, match: { ...h.match, mentions: h.match.mentions.map((m) => ({ ...m, snippet: null })) } })),
      insights,
      identity: identitySummary,
      watches,
      saved,
      basis: {
        pagesRetrieved: pages,
        recordsRetrieved: hits.length,
        totalReported: first.summary.total,
        totalIsApproximate: first.summary.totalIsApproximate,
        morePagesAvailable: Boolean(next),
        advanced,
      },
      coverage: first.coverage,
      status: first.status === "ok" && last.status === "ok" ? "ok" : first.status === "error" ? "error" : "partial",
      providerStatuses: first.providerStatuses,
      dataMode: first.dataMode,
      classification: first.classification,
    });
  } catch (e) {
    if (e instanceof InvalidSearchError) return apiError(400, "invalid_query", e.message);
    log.error("entity_profile_failed", { error: errorMessage(e) });
    return apiError(500, "profile_failed", "Could not build this profile.");
  }
}
