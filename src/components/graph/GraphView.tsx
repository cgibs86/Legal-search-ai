"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Filter, List, Network, Sparkles } from "lucide-react";
import type { LitigationGraph, GraphNodeKind } from "@/lib/graph/build";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Notice, Skeleton } from "@/components/ui/primitives";
import { GraphCanvas } from "./GraphCanvas";
import { cn } from "@/lib/utils";

interface GraphResponse {
  graph: LitigationGraph;
  dataMode: "live" | "demo";
  hits: { id: string; caseName: string; court: string; docketId: string | null; dateFiled: string | null }[];
}

const KIND_LABEL: Record<GraphNodeKind, string> = { entity: "Searched entity", case: "Case", court: "Court", judge: "Judge", attorney: "Attorney", firm: "Law firm", party: "Party" };
const KIND_DOT: Record<GraphNodeKind, string> = { entity: "bg-accent", case: "bg-cyan rounded-[2px]", court: "bg-violet", judge: "bg-amber", attorney: "bg-emerald", firm: "border-2 border-emerald", party: "bg-muted" };

export function GraphView({ searchBody, onFocusCases }: { searchBody: unknown; onFocusCases: (ids: string[] | null, label: string | null) => void }) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");

  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setView("list");
  }, []);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api<GraphResponse>("/api/graph", { method: "POST", json: searchBody })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e as ApiError));
    return () => {
      cancelled = true;
    };
  }, [searchBody]);

  const selectedNode = useMemo(() => data?.graph.nodes.find((n) => n.id === selected) ?? null, [data, selected]);
  const caseInfo = useMemo(() => new Map((data?.hits ?? []).map((h) => [h.id, h])), [data]);
  const grouped = useMemo(() => {
    const g = new Map<GraphNodeKind, LitigationGraph["nodes"]>();
    for (const n of data?.graph.nodes ?? []) {
      if (n.kind === "entity" || n.kind === "case") continue;
      g.set(n.kind, [...(g.get(n.kind) ?? []), n]);
    }
    for (const [k, v] of g) g.set(k, v.sort((a, b) => b.caseKeys.length - a.caseKeys.length));
    return g;
  }, [data]);

  if (error) return <Notice tone="rose" title="Graph unavailable">{error.message}</Notice>;
  if (!data) return <Skeleton className="h-[520px] w-full rounded-2xl" />;
  const { graph } = data;
  if (graph.nodes.length <= 1) return <Notice title="Not enough relationships">These results don&apos;t contain enough party, counsel or court information to draw relationships.</Notice>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
          <button onClick={() => setView("graph")} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", view === "graph" ? "bg-elev-2 text-fg" : "text-muted")}>
            <Network className="h-3.5 w-3.5" /> Graph
          </button>
          <button onClick={() => setView("list")} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", view === "list" ? "bg-elev-2 text-fg" : "text-muted")}>
            <List className="h-3.5 w-3.5" /> Relationships
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {(Object.keys(KIND_LABEL) as GraphNodeKind[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-2.5 w-2.5 rounded-full", KIND_DOT[k])} /> {KIND_LABEL[k]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t border-dashed border-muted" /> Opposite sides of caption
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {view === "graph" ? (
            <GraphCanvas nodes={graph.nodes} edges={graph.edges} selectedId={selected} onSelect={setSelected} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[...grouped.entries()].map(([kind, list]) => (
                <div key={kind} className="rounded-2xl border border-line bg-elev p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">{KIND_LABEL[kind]}s</div>
                  <ul className="space-y-1">
                    {list.slice(0, 12).map((n) => (
                      <li key={n.id}>
                        <button onClick={() => setSelected(n.id === selected ? null : n.id)} className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm", selected === n.id ? "bg-accent-soft text-accent" : "hover:bg-elev-2")}>
                          <span className="truncate">{n.label}</span>
                          <span className="shrink-0 text-xs text-subtle">{n.caseKeys.length}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {graph.truncated ? <p className="mt-2 text-xs text-subtle">Showing the first 60 matters. Narrow your search to see every relationship.</p> : null}
        </div>

        <aside className="space-y-3">
          {selectedNode ? (
            <div className="rounded-2xl border border-accent/30 bg-elev p-4 shadow-card">
              <Badge tone="accent">{KIND_LABEL[selectedNode.kind]}</Badge>
              <div className="mt-2 font-semibold leading-snug">{selectedNode.label}</div>
              <div className="mt-1 text-xs text-muted">Connected to {selectedNode.caseKeys.length} matter{selectedNode.caseKeys.length === 1 ? "" : "s"} in these results</div>
              <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto text-sm scrollbar-thin">
                {selectedNode.caseKeys.map((k) => {
                  const c = caseInfo.get(k);
                  return (
                    <li key={k} className="truncate">
                      {c?.docketId ? (
                        <Link href={`/docket/${c.docketId}`} className="hover:text-accent">
                          {c.caseName}
                        </Link>
                      ) : (
                        <span>{c?.caseName ?? k}</span>
                      )}
                      <span className="text-xs text-subtle"> · {c?.court}</span>
                    </li>
                  );
                })}
              </ul>
              <Button size="sm" variant="subtle" className="mt-3 w-full justify-center" onClick={() => onFocusCases(selectedNode.caseKeys, selectedNode.label)}>
                <Filter className="h-3.5 w-3.5" /> Filter results to these matters
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-elev p-4 text-sm text-muted">Select a node to see the matters it connects and filter your results.</div>
          )}
          <div className="rounded-2xl border border-line bg-elev p-4">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-violet" /> Repeated relationships
            </div>
            {graph.insights.length ? (
              <ul className="space-y-2">
                {graph.insights.map((i) => (
                  <li key={i.id}>
                    <button onClick={() => setSelected(i.nodeId)} className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-elev-2 hover:text-fg">
                      {i.text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-subtle">No relationship repeats across two or more of these matters.</p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-subtle">Relationships are drawn only from fields in the source records. Firms listed on a docket may represent any party in that case.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
