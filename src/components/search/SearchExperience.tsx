"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bell, BookmarkPlus, Database, Download, FileSearch, Fingerprint, LayoutList, Lock, MessageSquareText, Network, RefreshCw, SlidersHorizontal, UserSquare2, WifiOff, X, CalendarRange } from "lucide-react";
import type { CaseCategory, DeliveredHit, EntityType, MatchType, RecordKind, SearchFilters, SearchHit, SearchResponse, SortOrder } from "@/lib/domain/types";
import type { IdentityResolution } from "@/lib/domain/identity";
import type { FeatureKey } from "@/lib/config/plans";
import { api, ApiError, downloadPost, track } from "@/lib/client/api";
import { ENTITY_LABELS } from "@/lib/search/classify";
import { MATCH_META, LEVEL_LABEL } from "@/lib/ui/labels";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Badge, Button, EmptyState, Notice, Skeleton } from "@/components/ui/primitives";
import { Sheet, Tabs, useToast } from "@/components/ui/overlay";
import { SearchBar } from "./SearchBar";
import { Filters } from "./Filters";
import { CoverageLedger } from "./CoverageLedger";
import { LockedResultCard, ResultCard, isFull } from "./ResultCard";
import { PaywallOverlay } from "./Paywall";
import { AskPanel } from "./AskPanel";
import { IdentityLocked, IdentityPanel } from "@/components/identity/IdentityPanel";
import { GraphView } from "@/components/graph/GraphView";
import { EntityTimeline } from "@/components/timeline/TimelineView";
import { GateNotice, LockedFeature, SaveToProjectDialog, UpgradeDialog, WatchDialog, type SaveTarget, type WatchTarget } from "@/components/workspace/dialogs";

type Features = Record<FeatureKey, boolean>;
type Tab = "results" | "identity" | "graph" | "timeline";

interface Props {
  features: Features;
  signedIn: boolean;
  authEnabled: boolean;
  planName: string;
}

type ApiSearchResponse = SearchResponse & { suggestedVariants: { text: string; explanation: string }[]; entityType: EntityType; error: string | null };

const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : undefined);

export function filtersFromParams(p: URLSearchParams): SearchFilters {
  const f: SearchFilters = {
    matchTypes: csv(p.get("mt")) as MatchType[] | undefined,
    recordKinds: csv(p.get("rk")) as RecordKind[] | undefined,
    partyKind: (p.get("pk") as SearchFilters["partyKind"]) ?? undefined,
    jurisdiction: (p.get("j") as SearchFilters["jurisdiction"]) ?? undefined,
    states: csv(p.get("st")),
    courts: csv(p.get("ct")),
    categories: csv(p.get("cat")) as CaseCategory[] | undefined,
    status: (p.get("s") as SearchFilters["status"]) ?? undefined,
    filedAfter: p.get("fa") ?? undefined,
    filedBefore: p.get("fb") ?? undefined,
    terminatedAfter: p.get("ta") ?? undefined,
    terminatedBefore: p.get("tb") ?? undefined,
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")) as SearchFilters;
}

function filtersToParams(f: SearchFilters, p: URLSearchParams) {
  const map: [keyof SearchFilters, string][] = [["matchTypes", "mt"], ["recordKinds", "rk"], ["partyKind", "pk"], ["jurisdiction", "j"], ["states", "st"], ["courts", "ct"], ["categories", "cat"], ["status", "s"], ["filedAfter", "fa"], ["filedBefore", "fb"], ["terminatedAfter", "ta"], ["terminatedBefore", "tb"]];
  for (const [k, param] of map) {
    const v = f[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) p.delete(param);
    else p.set(param, Array.isArray(v) ? v.join(",") : String(v));
  }
}

export function SearchExperience({ features, signedIn, authEnabled, planName }: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  const q = params.get("q")?.trim() ?? "";
  const type = (params.get("type") as EntityType | null) ?? null;
  const mode = params.get("mode") === "docket" ? "docket" : "universal";
  const sort = (params.get("sort") as SortOrder | null) ?? "relevance";
  const tab = (params.get("tab") as Tab | null) ?? "results";
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);

  const body = useMemo(() => ({ query: q, entityType: type ?? undefined, mode, filters, sort, includeVariants: true }), [q, type, mode, filters, sort]);
  const [data, setData] = useState<ApiSearchResponse | null>(null);
  const [hits, setHits] = useState<DeliveredHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [focus, setFocus] = useState<{ ids: string[]; label: string } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [watchTarget, setWatchTarget] = useState<WatchTarget | null>(null);
  const [upgrade, setUpgrade] = useState<FeatureKey | null>(null);

  const updateParams = useCallback(
    (mutate: (p: URLSearchParams) => void, replace = false) => {
      const p = new URLSearchParams(params.toString());
      mutate(p);
      const url = `${pathname}?${p.toString()}`;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFocus(null);
    api<ApiSearchResponse>("/api/search", { method: "POST", json: body })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setHits(d.hits);
      })
      .catch((e) => !cancelled && setError(e as ApiError))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [body, q, reloadKey]);

  async function loadMore() {
    if (!data?.nextPageToken) return;
    setLoadingMore(true);
    try {
      const d = await api<ApiSearchResponse>("/api/search", { method: "POST", json: { ...body, pageToken: data.nextPageToken } });
      setHits((prev) => {
        const seen = new Set(prev.map((h) => h.id));
        return [...prev, ...d.hits.filter((h) => !seen.has(h.id))];
      });
      setData((prev) => (prev ? { ...prev, nextPageToken: d.nextPageToken } : d));
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setLoadingMore(false);
    }
  }

  const fullHits = hits.filter(isFull);
  const shown = focus ? hits.filter((h) => focus.ids.includes(h.id)) : hits;
  const locked = data?.paywall.locked ?? false;
  const entityType = data?.entityType ?? type ?? "unknown";
  const identity = data?.identity;
  const onFocus = (ids: string[] | null, label: string | null) => {
    setFocus(ids && label ? { ids, label } : null);
    updateParams((p) => p.set("tab", "results"), true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const gated = (feature: FeatureKey, fn: () => void) => () => (features[feature] ? fn() : setUpgrade(feature));

  async function saveSearch() {
    try {
      await api("/api/saved-searches", { method: "POST", json: { name: q, query: q, entityType, filters } });
      toast("Search saved to your workspace", "success");
    } catch (e) {
      const err = e as ApiError;
      if (err.needsUpgrade) setUpgrade("fullResults");
      else toast(err.message, "error");
    }
  }

  async function exportCsv() {
    try {
      await downloadPost("/api/export", { kind: "search", format: "csv", search: body }, "search.csv");
    } catch (e) {
      const err = e as ApiError;
      if (err.needsUpgrade) setUpgrade("exports");
      else toast(err.message, "error");
    }
  }

  const tabs = [
    { id: "results" as Tab, label: <><LayoutList className="h-4 w-4" /> Results</>, badge: data ? <span className="text-xs text-subtle">{formatNumber(data.summary.total)}</span> : null },
    { id: "identity" as Tab, label: <><Fingerprint className="h-4 w-4" /> Identity</>, badge: !features.identityResolution ? <Lock className="h-3 w-3 text-subtle" /> : identity && "clusters" in identity ? <span className="text-xs text-subtle">{identity.clusters.length}</span> : null },
    { id: "graph" as Tab, label: <><Network className="h-4 w-4" /> Graph</>, badge: !features.litigationGraph ? <Lock className="h-3 w-3 text-subtle" /> : null },
    { id: "timeline" as Tab, label: <><CalendarRange className="h-4 w-4" /> Timeline</>, badge: !features.entityTimeline ? <Lock className="h-3 w-3 text-subtle" /> : null },
  ];

  if (!q) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <h1 className="text-balance text-center text-3xl font-semibold tracking-tight sm:text-4xl">{mode === "docket" ? "Docket search" : "Search court records"}</h1>
        <p className="mt-3 text-center text-muted">{mode === "docket" ? "Find a case by docket number or case name — including cases that never produced a published opinion." : "Search a person, company, attorney, or docket across available federal and state sources."}</p>
        <SearchBar className="mt-8" mode={mode} autoFocus />
        <ModeToggle mode={mode} onChange={(m) => updateParams((p) => (m === "docket" ? p.set("mode", "docket") : p.delete("mode")))} className="mt-4 justify-center" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-24 pt-4 sm:px-6">
      <div className="sticky top-14 z-30 -mx-4 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 lg:flex-row lg:items-center">
          <SearchBar key={`${q}-${type}-${mode}`} initialQuery={q} initialType={type} mode={mode} size="md" className="lg:max-w-2xl" />
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
            <ModeToggle mode={mode} onChange={(m) => updateParams((p) => (m === "docket" ? p.set("mode", "docket") : p.delete("mode")))} />
            <button onClick={() => setFiltersOpen(true)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted hover:text-fg lg:hidden">
              <SlidersHorizontal className="h-4 w-4" /> Filters
              {Object.keys(filters).length ? <span className="text-accent">{Object.keys(filters).length}</span> : null}
            </button>
            <button onClick={() => setLedgerOpen(true)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted hover:text-fg xl:hidden">
              <Database className="h-4 w-4" /> Coverage
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_350px]">
        <aside className="hidden lg:block">
          <div className="sticky top-36 max-h-[calc(100dvh-10rem)] overflow-y-auto pr-1 scrollbar-thin">
            <Filters filters={filters} sort={sort} summary={data?.summary ?? null} advanced={features.advancedFilters} mode={mode} onChange={(f) => updateParams((p) => filtersToParams(f, p))} onSort={(s) => updateParams((p) => (s === "relevance" ? p.delete("sort") : p.set("sort", s)))} />
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {/* Heading + classification */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Searching as</span>
                <Badge tone="accent">{ENTITY_LABELS[entityType]}</Badge>
                {mode === "docket" ? <Badge tone="cyan">Docket search</Badge> : null}
                {data?.classification.candidates
                  .filter((c) => c.type !== entityType)
                  .slice(0, 3)
                  .map((c) => (
                    <button key={c.type} onClick={() => updateParams((p) => p.set("type", c.type))} className="rounded-md px-1.5 py-0.5 text-accent hover:bg-accent-soft">
                      {ENTITY_LABELS[c.type]}?
                    </button>
                  ))}
              </div>
              <h1 className="mt-1.5 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{q}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => setAskOpen((o) => !o)} disabled={!data}>
                <MessageSquareText className="h-4 w-4" /> Ask
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setWatchTarget({ kind: (["person", "company", "attorney", "law_firm", "case"] as string[]).includes(entityType) ? (entityType as WatchTarget["kind"]) : "search", label: q, query: { query: q, entityType } })}>
                <Bell className="h-4 w-4" /> Watch
              </Button>
              <Button variant="secondary" size="sm" onClick={saveSearch}>
                <BookmarkPlus className="h-4 w-4" /> Save
              </Button>
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!data || locked}>
                <Download className="h-4 w-4" /> Export
              </Button>
              {entityType !== "docket_number" && entityType !== "case" ? (
                <Link href={`/entity?q=${encodeURIComponent(q)}&type=${entityType}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-soft px-3 text-sm font-medium text-accent hover:opacity-90">
                  <UserSquare2 className="h-4 w-4" /> Profile
                </Link>
              ) : null}
            </div>
          </div>

          {loading && !data ? <ResultsSkeleton /> : null}
          {error ? <ErrorState error={error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}

          {data && !error ? (
            <>
              <SummaryStrip data={data} onMatchType={(t) => updateParams((p) => filtersToParams({ ...filters, matchTypes: filters.matchTypes?.includes(t) ? filters.matchTypes.filter((x) => x !== t) : [...(filters.matchTypes ?? []), t] }, p))} />
              {data.status === "partial" ? (
                <Notice tone="amber" icon={<AlertTriangle className="h-4 w-4 text-amber" />} title="PARTIAL RESULTS">
                  Some sources did not respond: {data.providerStatuses.filter((s) => ["failed", "timeout", "quota_exhausted"].includes(s.status)).map((s) => `${s.source} (${s.message ?? s.status})`).join("; ")}. Results from the other sources are shown.
                </Notice>
              ) : null}
              {data.status === "error" ? (
                <Notice tone="rose" icon={<WifiOff className="h-4 w-4 text-rose" />} title="Sources unavailable" action={<Button size="sm" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}>
                  {data.error ?? "No source responded."}
                </Notice>
              ) : null}
              {data.dataMode === "demo" ? (
                <Notice tone="amber" title="Demo snapshot — not live data">
                  This deployment has no CourtListener API token, so results come from a small, labeled snapshot of public records captured on Sep 30, 2026. Try “Epic Games”, “4:20-cv-05640” or “Gary Bornstein”.
                </Notice>
              ) : null}
              {data.ambiguity.ambiguous ? (
                <Notice tone="accent" icon={<Fingerprint className="h-4 w-4 text-accent" />} title="Ambiguous name">
                  {data.ambiguity.reason} Try: {data.ambiguity.suggestions.join(" · ")}.
                </Notice>
              ) : null}
              {data.suggestedVariants.length ? (
                <div className="text-xs text-muted">
                  Also try{" "}
                  {data.suggestedVariants.map((v) => (
                    <button key={v.text} className="font-medium text-accent hover:underline" onClick={() => router.push(`/search?q=${encodeURIComponent(v.text)}&type=company`)}>
                      “{v.text}”
                    </button>
                  ))}{" "}
                  — {data.suggestedVariants[0].explanation.toLowerCase()}.
                </div>
              ) : null}

              <Tabs tabs={tabs} value={tab} onChange={(t) => updateParams((p) => (t === "results" ? p.delete("tab") : p.set("tab", t)), true)} />

              <AnimatePresence>
                {askOpen ? (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    {features.askResults ? (
                      <AskPanel searchBody={body} hits={fullHits} onApply={onFocus} />
                    ) : (
                      <Notice tone="accent" icon={<Lock className="h-4 w-4 text-accent" />} title="Ask your results is included in Research Pro" action={<Button size="sm" onClick={() => setUpgrade("askResults")}>Upgrade</Button>}>
                        Ask questions like “Which of these cases are still active?” — answered by filtering the retrieved records.
                      </Notice>
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {tab === "results" ? (
                <div className="space-y-3">
                  {focus ? (
                    <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
                      <span className="text-muted">Filtered to</span> <span className="font-medium">{focus.label}</span> <span className="text-subtle">({focus.ids.length})</span>
                      <button onClick={() => setFocus(null)} className="ml-auto inline-flex items-center gap-1 text-xs text-accent">
                        <X className="h-3.5 w-3.5" /> Clear
                      </button>
                    </div>
                  ) : null}
                  {shown.length === 0 && data.status !== "error" ? (
                    <EmptyState icon={<FileSearch className="h-8 w-8" />} title="No matching records found" action={<Button variant="secondary" onClick={() => setLedgerOpen(true)}>See what was searched</Button>}>
                      Nothing in the searched sources matched{Object.keys(filters).length ? " with these filters" : ""}. This does not mean no records exist — check the Coverage Ledger for sources we could not search, try another spelling, or remove filters.
                    </EmptyState>
                  ) : null}
                  <div className={cn("relative space-y-3", locked && "pb-4")}>
                    {shown.map((h, i) =>
                      isFull(h) ? (
                        <ResultCard
                          key={h.id}
                          hit={h}
                          index={i}
                          actions={{
                            mentionIntelligence: features.mentionIntelligence,
                            onUpgrade: (f) => setUpgrade(f as FeatureKey),
                            onSave: (hit: SearchHit) => setSaveTarget({ kind: hit.record.kinds.includes("docket") ? "docket" : "case", title: hit.record.caseName, ref: { recordKey: hit.id, docketId: hit.record.providerDocketId, clusterId: hit.record.opinions[0]?.clusterId ?? null, court: hit.record.court.citation ?? hit.record.court.name, docketNumber: hit.record.docketNumber, url: hit.record.sources[0]?.url ?? null, matchTypes: hit.match.types, query: q } }),
                            onWatch: (hit: SearchHit) =>
                              hit.record.providerDocketId && hit.record.kinds.includes("docket")
                                ? setWatchTarget({ kind: "docket", label: hit.record.caseName, query: { docketId: hit.record.providerDocketId, recordKey: hit.id } })
                                : setWatchTarget({ kind: "search", label: q, query: { query: q, entityType } }),
                          }}
                        />
                      ) : (
                        <LockedResultCard key={h.id} hit={h} index={i} />
                      ),
                    )}
                    {locked && data.summary.total > data.paywall.unlockedCount ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-bg via-bg/80 to-transparent" />
                    ) : null}
                  </div>
                  {locked && data.summary.total > data.paywall.unlockedCount ? <PaywallOverlay state={data.paywall} summary={data.summary} returnTo={`/search?${params.toString()}`} authEnabled={authEnabled} /> : null}
                  {!locked && data.nextPageToken && !focus ? (
                    <div className="flex justify-center pt-2">
                      <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
                        Load more results
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "identity" ? (
                identity && "clusters" in identity ? (
                  <IdentityPanel resolution={identity as IdentityResolution} hits={fullHits} canEdit={signedIn} onChanged={() => setReloadKey((k) => k + 1)} />
                ) : (
                  <IdentityLocked clusterCount={identity && "clusterCount" in identity ? identity.clusterCount : 0} signedIn={signedIn} />
                )
              ) : null}
              {tab === "graph" ? (features.litigationGraph ? <GraphView searchBody={body} onFocusCases={onFocus} /> : <LockedFeature feature="litigationGraph" title="Litigation Graph" text="See how this name connects to cases, courts, judges, counsel and co-parties — and which relationships repeat." onUpgrade={setUpgrade} />) : null}
              {tab === "timeline" ? (features.entityTimeline ? <EntityTimeline searchBody={body} /> : <LockedFeature feature="entityTimeline" title="Entity Timeline" text="Every filing, decision and termination on one zoomable timeline — from years down to individual docket events." onUpgrade={setUpgrade} />) : null}
            </>
          ) : null}
        </main>

        <aside className="hidden xl:block">
          <div className="sticky top-36 max-h-[calc(100dvh-10rem)] overflow-y-auto scrollbar-thin">{data ? <CoverageLedger ledger={data.coverage} /> : <Skeleton className="h-96 w-full rounded-2xl" />}</div>
        </aside>
      </div>

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" footer={<Button className="w-full justify-center" onClick={() => setFiltersOpen(false)}>Show {data ? formatNumber(data.summary.total) : ""} results</Button>}>
        <Filters filters={filters} sort={sort} summary={data?.summary ?? null} advanced={features.advancedFilters} mode={mode} onChange={(f) => updateParams((p) => filtersToParams(f, p))} onSort={(s) => updateParams((p) => (s === "relevance" ? p.delete("sort") : p.set("sort", s)))} />
      </Sheet>
      <Sheet open={ledgerOpen} onClose={() => setLedgerOpen(false)} title="Coverage Ledger" side="right">
        {data ? <CoverageLedger ledger={data.coverage} /> : null}
      </Sheet>
      <SaveToProjectDialog target={saveTarget} onClose={() => setSaveTarget(null)} signedIn={signedIn} />
      <WatchDialog target={watchTarget} onClose={() => setWatchTarget(null)} signedIn={signedIn} />
      <UpgradeDialog feature={upgrade} onClose={() => setUpgrade(null)} signedIn={signedIn} />
      <span className="sr-only">Current plan: {planName}</span>
    </div>
  );
}

function ModeToggle({ mode, onChange, className }: { mode: "universal" | "docket"; onChange: (m: "universal" | "docket") => void; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1 rounded-lg border border-line p-0.5", className)} role="group" aria-label="Search mode">
      {(["universal", "docket"] as const).map((m) => (
        <button key={m} onClick={() => onChange(m)} aria-pressed={mode === m} className={cn("h-8 rounded-md px-3 text-xs font-medium transition", mode === m ? "bg-elev-2 text-fg" : "text-muted hover:text-fg")}>
          {m === "universal" ? "Universal" : "Docket search"}
        </button>
      ))}
    </div>
  );
}

function SummaryStrip({ data, onMatchType }: { data: ApiSearchResponse; onMatchType: (t: MatchType) => void }) {
  const s = data.summary;
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-elev p-4 shadow-card sm:grid-cols-[auto_1fr]">
      <div className="pr-4 sm:border-r sm:border-line">
        <div className="text-[11px] uppercase tracking-[0.14em] text-subtle">Matters found</div>
        <div className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">
          {formatNumber(s.total)}
          {s.totalIsApproximate ? <span className="text-lg text-subtle">+</span> : null}
        </div>
        <div className="text-xs text-muted">{s.dateRange.from ? `${formatDate(s.dateRange.from, { year: "numeric" })} – ${formatDate(s.dateRange.to, { year: "numeric" })}` : "Dates unknown"}</div>
      </div>
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(MATCH_META) as MatchType[]).map((t) =>
            s.byMatchType[t] ? (
              <button key={t} onClick={() => onMatchType(t)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs hover:border-line-strong" title={MATCH_META[t].description}>
                <Badge tone={MATCH_META[t].tone}>{MATCH_META[t].label}</Badge>
                <span className="tabular-nums text-muted">{s.byMatchType[t]}</span>
              </button>
            ) : null,
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>Jurisdictions: {s.jurisdictions.map((j) => `${LEVEL_LABEL[j.level]} ${j.count}`).join(" · ") || "—"}</span>
          <span>Records: {s.byKind.docket} dockets · {s.byKind.opinion} opinions · {s.byKind.filing} filings</span>
          {s.states.length ? <span>States: {s.states.slice(0, 6).map((x) => x.state).join(", ")}{s.states.length > 6 ? "…" : ""}</span> : null}
          <span>{data.tookMs} ms</span>
        </div>
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading results">
      <Skeleton className="h-24 w-full rounded-2xl" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-line bg-elev p-5">
          <div className="flex gap-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-4 gap-3 pt-2">
            {[0, 1, 2, 3].map((j) => (
              <Skeleton key={j} className="h-8" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (error.code === "rate_limited") {
    return (
      <Notice tone="amber" title="Search limit reached" action={<Link className="text-sm font-medium text-accent" href="/signup">Create account</Link>}>
        {error.message} {error.extra.resetAt ? `Resets ${new Date(error.extra.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}
      </Notice>
    );
  }
  if (error.code === "invalid_query") return <Notice tone="amber" title="Check your search">{error.message}</Notice>;
  if (error.code === "network") {
    return (
      <Notice tone="rose" icon={<WifiOff className="h-4 w-4 text-rose" />} title="You appear to be offline" action={<Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}>
        {error.message}
      </Notice>
    );
  }
  if (error.needsUpgrade) return <GateNotice error={error} />;
  return (
    <Notice tone="rose" title="Search failed" action={<Button size="sm" variant="secondary" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}>
      {error.message}
    </Notice>
  );
}

