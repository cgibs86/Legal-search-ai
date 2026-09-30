import "server-only";
import type { Viewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/session";
import { getRepo } from "@/lib/data/repo";
import { entityKeyFor, resolveIdentities } from "@/lib/identity/cluster";
import type { SearchBody } from "@/lib/api/schemas";
import { runSearch, type InternalSearchResult } from "./orchestrator";

/**
 * Shared entry point for features that need the full, unmasked hit list for an entitled
 * user (graph, timeline, ask, entity profile, exports). Provider responses are cached,
 * so re-running a recent search costs no upstream requests.
 */
export async function searchForViewer(viewer: Viewer, body: SearchBody, opts: { includePacer?: boolean } = {}): Promise<InternalSearchResult> {
  return runSearch(
    { query: body.query, entityType: body.entityType, mode: body.mode, filters: body.filters, sort: body.sort, includeVariants: body.includeVariants, pageToken: body.pageToken ?? null },
    { userId: viewer.userId, plan: viewer.plan, includePacer: opts.includePacer },
  );
}

export async function identityFor(viewer: Viewer, result: InternalSearchResult) {
  const corrections = can(viewer, "identityResolution") ? ((await (await getRepo(viewer))?.listCorrections(entityKeyFor(result.query, result.entityType))) ?? []) : [];
  return resolveIdentities({ hits: result.hits, entityType: result.entityType, query: result.query, variants: result.variants, corrections });
}
