"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, CircleDashed, CircleSlash, Clock, Database, Info, TriangleAlert, XCircle } from "lucide-react";
import type { CoverageLedger as Ledger, SourceStatus } from "@/lib/domain/types";
import { Badge } from "@/components/ui/primitives";
import { STATUS_META } from "@/lib/ui/labels";
import { cn, formatNumber } from "@/lib/utils";

function StatusIcon({ status }: { status: SourceStatus }) {
  if (status === "searched") return <CheckCircle2 className="h-4 w-4 text-emerald" />;
  if (status === "partial" || status === "quota_exhausted") return <TriangleAlert className="h-4 w-4 text-amber" />;
  if (status === "failed" || status === "timeout") return <XCircle className="h-4 w-4 text-rose" />;
  if (status === "unavailable") return <CircleSlash className="h-4 w-4 text-rose" />;
  return <CircleDashed className="h-4 w-4 text-subtle" />;
}

/**
 * COVERAGE LEDGER — the per-search record of exactly what was searched, what wasn't,
 * and how reliable the counts are.
 */
export function CoverageLedger({ ledger, compact = false }: { ledger: Ledger; compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);
  const searched = ledger.sources.filter((s) => s.status === "searched" || s.status === "partial");
  const notSearched = ledger.sources.filter((s) => !(s.status === "searched" || s.status === "partial"));
  return (
    <section aria-label="Coverage Ledger" className="rounded-2xl border border-line bg-elev shadow-card">
      <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left" aria-expanded={expanded}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-soft text-cyan">
          <Database className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Coverage Ledger</span>
          <span className="block truncate text-xs text-muted">
            {searched.length} source{searched.length === 1 ? "" : "s"} searched · {notSearched.length} not searched · {new Date(ledger.searchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        </span>
        {ledger.dataMode === "demo" ? <Badge tone="amber">Demo data</Badge> : null}
        <ChevronDown className={cn("h-4 w-4 text-subtle transition", expanded && "rotate-180")} />
      </button>
      {expanded ? (
        <div className="space-y-5 border-t border-line px-4 pb-4 pt-4 text-sm">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">Sources</div>
            <ul className="space-y-2">
              {ledger.sources.map((s) => (
                <li key={s.id} className="rounded-xl border border-line bg-elev-2/60 p-3">
                  <div className="flex items-start gap-2.5">
                    <StatusIcon status={s.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">{s.label}</span>
                        <Badge tone={STATUS_META[s.status].tone === "neutral" ? "neutral" : STATUS_META[s.status].tone}>{STATUS_META[s.status].label}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted">{s.recordTypes.join(" · ")} — {s.jurisdictions}</div>
                      {s.resultCount != null ? (
                        <div className="mt-1 text-xs text-muted">
                          {s.countIsApproximate ? "About " : ""}
                          {formatNumber(s.resultCount)} source result{s.resultCount === 1 ? "" : "s"}
                          {s.countIsApproximate ? " (estimate ±6%)" : ""}
                        </div>
                      ) : null}
                      {s.dateCoverage ? <div className="mt-1 text-xs text-subtle">Date coverage: {s.dateCoverage}</div> : null}
                      {s.freshness ? (
                        <div className="mt-1 flex items-center gap-1 text-xs text-subtle">
                          <Clock className="h-3 w-3" /> {s.freshness}
                        </div>
                      ) : null}
                      {s.note ? <div className="mt-1.5 text-xs text-muted">{s.note}</div> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">Jurisdictions searched</div>
              {ledger.jurisdictionsSearched.length ? (
                <ul className="space-y-1.5">
                  {ledger.jurisdictionsSearched.map((j) => (
                    <li key={j.label} className="text-xs text-muted">
                      <span className="font-medium text-fg">{j.label}</span> · {formatNumber(j.courts)} courts
                      <div className="text-subtle">{j.note}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-muted">No jurisdictions were searched successfully.</div>
              )}
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose">Not searched / unavailable</div>
              <ul className="space-y-1.5">
                {ledger.jurisdictionsUnavailable.map((j) => (
                  <li key={j.label} className="text-xs text-muted">
                    <span className="font-medium text-fg">{j.label}</span>
                    <div className="text-subtle">{j.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">Record types</div>
            <div className="flex flex-wrap gap-1.5">
              {ledger.recordTypes.map((r) => (
                <span key={r.type} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs", r.searched ? "border-emerald/30 bg-emerald-soft text-fg" : "border-line text-subtle line-through decoration-rose/60")} title={r.note}>
                  {r.searched ? <CheckCircle2 className="h-3 w-3 text-emerald" /> : <XCircle className="h-3 w-3 text-rose" />}
                  {r.type}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">Name forms searched</div>
            <ul className="space-y-1">
              {ledger.variantsSearched.map((v) => (
                <li key={v.text} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md bg-elev-2 px-1.5 py-0.5 font-mono text-fg">{v.text}</span>
                  <span className="text-subtle">{v.explanation}</span>
                  {v.strength === "weaker" ? <Badge tone="rose">Broader</Badge> : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-elev-2 p-3 text-xs text-muted">
            <div className="flex items-center gap-1.5 font-medium text-fg">
              <Info className="h-3.5 w-3.5" /> Counts: {ledger.counts.exact ? "exact" : "approximate"}
            </div>
            <div className="mt-1">{ledger.counts.note}</div>
            {ledger.filtersApplied.length ? <div className="mt-1">Filters: {ledger.filtersApplied.join(" · ")}</div> : null}
          </div>

          <ul className="space-y-1 text-xs text-subtle">
            {ledger.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
