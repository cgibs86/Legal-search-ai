import type { ProjectItem, ProjectItemKind } from "@/lib/data/types";
import type { CaseBrief } from "@/lib/brief/validate";
import { searchHref } from "@/lib/search/urlParams";

export const ITEM_KIND_LABEL: Record<ProjectItemKind, string> = {
  entity: "Entity",
  case: "Case",
  docket: "Docket",
  filing: "Filing",
  note: "Note",
  ai_summary: "AI Case Brief",
  timeline_item: "Timeline item",
  graph_view: "Graph view",
  search: "Search",
};

export const ITEM_KIND_ORDER: ProjectItemKind[] = ["entity", "docket", "case", "filing", "ai_summary", "timeline_item", "graph_view", "search", "note"];

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Internal link, source link and metadata line for a saved item, from its stored ref only. */
export function describeItem(item: ProjectItem): { href: string | null; source: string | null; meta: string[]; brief: CaseBrief | null } {
  const r = item.ref;
  const docketId = str(r.docketId);
  const clusterId = str(r.clusterId);
  const query = str(r.query);
  let href: string | null = null;
  if (item.kind === "entity" && query) href = `/entity?q=${encodeURIComponent(query)}${str(r.entityType) ? `&type=${r.entityType}` : ""}`;
  else if (item.kind === "search" && query) href = searchHref(query, str(r.entityType));
  else if (docketId) href = `/docket/${docketId}`;
  else if (clusterId) href = `/case/${clusterId}`;
  const meta = [str(r.court), str(r.docketNumber), Array.isArray(r.citations) ? (r.citations as string[]).join(", ") || null : null, str(r.date)].filter((x): x is string => Boolean(x));
  const brief = r.brief && typeof r.brief === "object" && Array.isArray((r.brief as CaseBrief).sections) ? (r.brief as CaseBrief) : null;
  return { href, source: str(r.url), meta, brief };
}
