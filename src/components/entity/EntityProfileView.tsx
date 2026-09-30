"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, BookmarkPlus, Building2, ExternalLink, FileText, Fingerprint, Landmark, Lock, Network, Quote, RefreshCw, Briefcase, Users, X } from "lucide-react";
import type { CoverageLedger as Ledger, DocumentHit, EntityType, ProviderStatusEntry, SearchHit } from "@/lib/domain/types";
import type { CounterpartyTally, EntityProfile, Tally } from "@/lib/entity/profile";
import type { GraphInsight } from "@/lib/graph/build";
import type { FeatureKey } from "@/lib/config/plans";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, ButtonLink, EmptyState, Notice, SectionLabel, Skeleton } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlay";
import { CoverageLedger } from "@/components/search/CoverageLedger";
import { Snippet } from "@/components/search/Snippet";
import { EntityTimeline } from "@/components/timeline/TimelineView";
import { LockedFeature, SaveToProjectDialog, UpgradeDialog, WatchDialog, type SaveTarget, type WatchTarget } from "@/components/workspace/dialogs";
import { CATEGORY_LABEL, KIND_LABEL, LEVEL_LABEL, MATCH_META } from "@/lib/ui/labels";
import { cn, formatDate, formatNumber, plural } from "@/lib/utils";

const TYPE_LABEL: Record<EntityType, string> = { person: "Person", company: "Company", attorney: "Attorney", law_firm: "Law firm", case: "Case", docket_number: "Docket number", unknown: "Name" };
const WATCH_KIND: Partial<Record<EntityType, WatchTarget["kind"]>> = { person: "person", company: "company", attorney: "attorney", law_firm: "law_firm" };
const RELATION_LABEL: Record<CounterpartyTally["relation"], string> = { opposite_caption: "Opposite side of caption", co_party: "Same side of caption", same_case: "Named in same case" };

interface EntityResponse {
  profile: EntityProfile;
  hits: SearchHit[];
  insights: GraphInsight[] | null;
  identity: { locked: boolean; clusters: number; byConfidence: Record<string, number> };
  watches: { id: string; label: string; frequency: string; active: boolean }[];
  saved: { projectId: string; projectName: string; itemId: string; title: string; kind: string }[];
  basis: { pagesRetrieved: number; recordsRetrieved: number; totalReported: number; totalIsApproximate: boolean; morePagesAvailable: boolean; advanced: boolean };
  coverage: Ledger;
  status: "ok" | "partial" | "error";
  providerStatuses: ProviderStatusEntry[];
  dataMode: "live" | "demo";
}

type Tab = "overview" | "cases" | "dockets" | "mentions" | "timeline" | "courts" | "parties" | "attorneys" | "companies" | "documents" | "monitor";

export function EntityProfileView({ query, entityType, features, signedIn }: { query: string; entityType: EntityType | null; features: Record<FeatureKey, boolean>; signedIn: boolean }) {
  const [data, setData] = useState<EntityResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [focus, setFocus] = useState<{ label: string; keys: string[] } | null>(null);
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [watchTarget, setWatchTarget] = useState<WatchTarget | null>(null);
  const [upgrade, setUpgrade] = useState<FeatureKey | null>(null);
  const [reload, setReload] = useState(0);
  const body = useMemo(() => ({ query, entityType: entityType ?? undefined, mode: "universal" as const, filters: {}, sort: "relevance" as const, includeVariants: true }), [query, entityType]);

  useEffect(() => {
    setData(null);
    setError(null);
    api<EntityResponse>("/api/entity", { method: "POST", json: body })
      .then(setData)
      .catch((e) => setError(e as ApiError));
  }, [body, reload]);

  function focusOn(label: string, keys: string[]) {
    setFocus({ label, keys });
    setTab("cases");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {error.needsUpgrade ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold">Entity profiles are included with every paid plan</h1>
            <p className="text-muted">{error.message}</p>
            <div className="flex justify-center gap-2">
              <ButtonLink href={signedIn ? "/pricing" : `/signup?next=${encodeURIComponent(`/entity?q=${query}`)}`}>{signedIn ? "See plans" : "Create account"}</ButtonLink>
              <ButtonLink href={`/search?q=${encodeURIComponent(query)}`} variant="secondary">
                Back to results
              </ButtonLink>
            </div>
          </div>
        ) : (
          <Notice tone="rose" title="Could not build this profile" action={<Button size="sm" variant="secondary" onClick={() => setReload((n) => n + 1)}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}>
            {error.message}
          </Notice>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-10 w-2/3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
        <p className="text-sm text-subtle">Collecting records, courts, counsel and counterparties…</p>
      </div>
    );
  }

  const { profile: p, hits } = data;
  const o = p.overview;
  const type = p.entityType;
  const focusedHits = focus ? hits.filter((h) => focus.keys.includes(h.record.key)) : hits;
  const dockets = hits.filter((h) => h.record.providerDocketId && h.record.kinds.includes("docket"));
  const mentionHits = hits.filter((h) => h.match.types.includes("mention"));
  const watchKind = WATCH_KIND[type];

  const tabs: { id: Tab; label: string; badge?: React.ReactNode; locked?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "cases", label: "Cases", badge: <Count n={hits.length} /> },
    { id: "dockets", label: "Dockets", badge: <Count n={dockets.length} /> },
    { id: "mentions", label: "Mentions", badge: <Count n={mentionHits.length} /> },
    { id: "timeline", label: "Timeline" },
    { id: "courts", label: "Courts", badge: <Count n={p.courts.length} /> },
    { id: "parties", label: "Parties", badge: <Count n={p.counterparties.length} /> },
    { id: "attorneys", label: "Attorneys & firms", badge: <Count n={p.attorneys.length + p.firms.length} /> },
    { id: "companies", label: "Companies", badge: <Count n={p.companies.length} /> },
    { id: "documents", label: "Documents", badge: <Count n={p.documents.length} /> },
    { id: "monitor", label: "Watchlist & saved" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <Link href={`/search?q=${encodeURIComponent(query)}${entityType ? `&type=${entityType}` : ""}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        ← Results for “{query}”
      </Link>

      <header className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">Entity profile</Badge>
          <Badge>{TYPE_LABEL[type]}</Badge>
          {data.dataMode === "demo" ? <Badge tone="amber">Demo snapshot — not live</Badge> : null}
          {data.status === "partial" ? <Badge tone="amber">Partial results</Badge> : null}
          {data.basis.advanced ? <Badge tone="violet">Advanced profile</Badge> : null}
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{query}</h1>
        <p className="max-w-3xl text-sm text-muted">
          Built from {plural(data.basis.recordsRetrieved, "retrieved record", "retrieved records")}
          {data.basis.totalReported > data.basis.recordsRetrieved ? ` of ${data.basis.totalIsApproximate ? "about " : ""}${formatNumber(data.basis.totalReported)} reported` : ""}.{" "}
          Every figure below is a count over those records and links back to them.
          {data.basis.morePagesAvailable && !data.basis.advanced ? " Intelligence profiles read deeper into large result sets." : ""}
        </p>
        <p className="flex max-w-3xl items-start gap-2 rounded-xl bg-elev-2 px-3 py-2 text-xs text-muted">
          <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />
          {type === "person" || type === "attorney"
            ? "Records with matching names are grouped here by name only. Different people can share a name — use Identity Resolution to review which records likely belong together. Filings contain allegations, not findings."
            : "Records are grouped by name. Similar company names can belong to unrelated entities. Filings contain allegations, not findings."}
        </p>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {watchKind ? (
          <Button size="sm" onClick={() => setWatchTarget({ kind: watchKind, label: query, query: { query, entityType: type } })}>
            <Bell className="h-4 w-4" /> Watch this name
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setSaveTarget({ kind: "entity", title: query, ref: { query, entityType: type, records: hits.length } })}>
          <BookmarkPlus className="h-4 w-4" /> Save to project
        </Button>
        <ButtonLink size="sm" variant="secondary" href={`/search?q=${encodeURIComponent(query)}${entityType ? `&type=${entityType}` : ""}&tab=graph`}>
          <Network className="h-4 w-4" /> Litigation Graph
        </ButtonLink>
        <ButtonLink size="sm" variant="secondary" href={`/search?q=${encodeURIComponent(query)}${entityType ? `&type=${entityType}` : ""}&tab=identity`}>
          <Fingerprint className="h-4 w-4" /> Identity Resolution
        </ButtonLink>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Records" value={formatNumber(o.records)} />
        <Stat label="As party" value={formatNumber(o.byMatchType.party)} />
        <Stat label="Mentioned" value={formatNumber(o.byMatchType.mention)} />
        <Stat label="First seen" value={o.firstSeen ? formatDate(o.firstSeen) : null} />
        <Stat label="Latest activity" value={o.lastSeen ? formatDate(o.lastSeen) : null} />
        <Stat label="Courts" value={formatNumber(p.courts.length)} />
      </div>

      {data.status !== "ok" ? (
        <Notice tone="amber" className="mt-4" title="PARTIAL RESULTS">
          {data.providerStatuses.filter((s) => ["partial", "failed", "timeout", "quota_exhausted"].includes(s.status)).map((s) => `${s.source}: ${s.message ?? s.status.replace("_", " ")}`).join(" · ") || "Some sources did not respond. Counts may be incomplete."}
        </Notice>
      ) : null}

      <Tabs className="mt-6" tabs={tabs} value={tab} onChange={(t) => { setTab(t); if (t !== "cases") setFocus(null); }} />

      <div className="mt-4">
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Panel title="Activity by year">
                <YearBars data={o.byYear} />
              </Panel>
              <Panel title="Repeated relationships" icon={<Network className="h-4 w-4" />}>
                {data.insights === null ? (
                  <LockedLine text="Which firms, attorneys, courts and counterparties repeat across these matters — included in Research Pro." onClick={() => setUpgrade("litigationGraph")} />
                ) : data.insights.length ? (
                  <ul className="space-y-1.5">
                    {data.insights.map((i) => (
                      <li key={i.id}>
                        <button onClick={() => focusOn(i.text, i.recordKeys)} className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-elev-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                          <span className="flex-1">{i.text}</span>
                          <ArrowRight className="mt-0.5 h-3.5 w-3.5 text-subtle opacity-0 transition group-hover:opacity-100" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No relationship repeats across these records.</p>
                )}
              </Panel>
              <Panel title="Where it appears">
                <div className="grid gap-4 sm:grid-cols-2">
                  <MiniList title="Match type" rows={(Object.keys(o.byMatchType) as (keyof typeof o.byMatchType)[]).filter((k) => o.byMatchType[k]).map((k) => ({ label: MATCH_META[k].label, count: o.byMatchType[k] }))} total={o.records} />
                  <MiniList title="Record type" rows={(Object.keys(o.byKind) as (keyof typeof o.byKind)[]).filter((k) => o.byKind[k]).map((k) => ({ label: KIND_LABEL[k], count: o.byKind[k] }))} total={o.records} />
                  <MiniList title="Case type" rows={o.categories.map((c) => ({ label: CATEGORY_LABEL[c.category], count: c.count }))} total={o.records} />
                  <MiniList title="Jurisdiction" rows={o.jurisdictions.map((j) => ({ label: LEVEL_LABEL[j.level], count: j.count }))} total={o.records} />
                </div>
              </Panel>
            </div>
            <div className="space-y-4">
              <Panel title="Status">
                <MiniList
                  title=""
                  rows={[
                    { label: "Open", count: o.status.active },
                    { label: "Terminated", count: o.status.closed },
                    { label: "Not reported", count: o.status.unknown },
                  ].filter((r) => r.count)}
                  total={o.records}
                />
              </Panel>
              <Panel title="Party roles">
                {o.roles.length ? <MiniList title="" rows={o.roles.map((r) => ({ label: r.role, count: r.count }))} total={o.byMatchType.party} /> : <p className="text-sm text-muted">Not listed as a party in these records.</p>}
                <p className="mt-2 text-[11px] text-subtle">From party records where captured; otherwise from caption position.</p>
              </Panel>
              <Panel title="Identity clusters" icon={<Fingerprint className="h-4 w-4" />}>
                {data.identity.locked ? (
                  <LockedLine text={`${plural(data.identity.clusters, "possible grouping", "possible groupings")} of records — review them with Identity Resolution.`} onClick={() => setUpgrade("identityResolution")} />
                ) : (
                  <div className="space-y-2 text-sm">
                    <p>
                      {plural(data.identity.clusters, "group", "groups")} of records:{" "}
                      {Object.entries(data.identity.byConfidence)
                        .map(([k, v]) => `${v} ${k}`)
                        .join(", ")}
                      .
                    </p>
                    <Link className="inline-flex items-center gap-1 text-accent hover:underline" href={`/search?q=${encodeURIComponent(query)}${entityType ? `&type=${entityType}` : ""}&tab=identity`}>
                      Review groupings <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}
              </Panel>
              <CoverageLedger ledger={data.coverage} compact />
            </div>
          </div>
        ) : null}

        {tab === "cases" ? (
          <div className="space-y-2">
            {focus ? (
              <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm">
                <span className="flex-1">
                  Showing {plural(focusedHits.length, "record", "records")} behind: <span className="font-medium">{focus.label}</span>
                </span>
                <button onClick={() => setFocus(null)} className="rounded p-1 text-muted hover:text-fg" aria-label="Clear focus">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            <CaseRows hits={focusedHits} />
          </div>
        ) : null}

        {tab === "dockets" ? (dockets.length ? <CaseRows hits={dockets} /> : <EmptyState icon={<FileText className="h-6 w-6" />} title="No docket records">Opinions and filings without an underlying docket in the source are listed under Cases.</EmptyState>) : null}

        {tab === "mentions" ? (
          !features.mentionIntelligence ? (
            <LockedFeature feature="mentionIntelligence" title="Mention Intelligence" text={`${plural(mentionHits.length, "record mentions", "records mention")} this name outside the party list. See the exact passage, document and filing date for each.`} onUpgrade={setUpgrade} />
          ) : mentionHits.length ? (
            <div className="space-y-3">
              {mentionHits.map((h) => (
                <div key={h.id} className="rounded-2xl border border-line bg-elev p-4 shadow-card">
                  <RecordLink hit={h} />
                  <div className="mt-2 space-y-2">
                    {h.match.mentions.length ? (
                      h.match.mentions.slice(0, 3).map((d) => <MentionBlock key={d.id} doc={d} />)
                    ) : (
                      <p className="text-xs text-subtle">The source reported this match without a text excerpt.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Quote className="h-6 w-6" />} title="No mentions outside party lists">This name appears only as a party or counsel in the retrieved records.</EmptyState>
          )
        ) : null}

        {tab === "timeline" ? (features.entityTimeline ? <EntityTimeline searchBody={body} /> : <LockedFeature feature="entityTimeline" title="Entity Timeline" text="Every filing, decision and termination for this name on one zoomable timeline." onUpgrade={setUpgrade} />) : null}

        {tab === "courts" ? <TallyTable rows={p.courts} icon={<Landmark className="h-4 w-4" />} empty="No courts" onFocus={focusOn} detail={(c) => [LEVEL_LABEL[(c as (typeof p.courts)[number]).level], (c as (typeof p.courts)[number]).state].filter(Boolean).join(" · ")} /> : null}

        {tab === "parties" ? (
          <TallyTable rows={p.counterparties} icon={<Users className="h-4 w-4" />} empty="No other parties captured" onFocus={focusOn} detail={(c) => `${RELATION_LABEL[(c as CounterpartyTally).relation]}${(c as CounterpartyTally).isOrganization ? " · Organization" : ""}`} note="Other parties named in the same records. “Opposite side of caption” comes from the case caption only; it does not establish who sued whom unless a party record states the role." />
        ) : null}

        {tab === "attorneys" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <SectionLabel className="mb-2">Attorneys of record</SectionLabel>
              <TallyTable rows={p.attorneys} icon={<Briefcase className="h-4 w-4" />} empty="No attorneys listed" onFocus={focusOn} />
            </div>
            <div>
              <SectionLabel className="mb-2">Law firms</SectionLabel>
              <TallyTable rows={p.firms} icon={<Building2 className="h-4 w-4" />} empty="No firms listed" onFocus={focusOn} />
            </div>
            <p className="text-xs text-subtle lg:col-span-2">Counsel listed anywhere on the docket, for any party — not necessarily representing “{query}”. Where the party record states representation, the docket view shows it.</p>
          </div>
        ) : null}

        {tab === "companies" ? <TallyTable rows={p.companies} icon={<Building2 className="h-4 w-4" />} empty="No organizations named alongside this name" onFocus={focusOn} detail={(c) => RELATION_LABEL[(c as CounterpartyTally).relation]} /> : null}

        {tab === "documents" ? (
          p.documents.length ? (
            <div className="divide-y divide-line rounded-2xl border border-line bg-elev shadow-card">
              {p.documents.map((d) => (
                <div key={d.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-xs text-muted">
                      {d.caseName}
                      {d.date ? ` · ${formatDate(d.date)}` : ""}
                      {d.entryNumber ? ` · Entry ${d.entryNumber}` : ""}
                      {d.pageCount ? ` · ${d.pageCount}p` : ""}
                    </div>
                    {d.snippet && features.mentionIntelligence ? <Snippet snippet={d.snippet} className="mt-1 text-xs text-muted" /> : null}
                  </div>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<FileText className="h-6 w-6" />} title="No documents in these results">Open a docket to see its filings.</EmptyState>
          )
        ) : null}

        {tab === "monitor" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Case Radar" icon={<Bell className="h-4 w-4" />}>
              {data.watches.length ? (
                <ul className="space-y-2 text-sm">
                  {data.watches.map((w) => (
                    <li key={w.id} className="flex items-center gap-2">
                      <Badge tone={w.active ? "emerald" : "neutral"}>{w.active ? "Active" : "Paused"}</Badge>
                      <span className="flex-1">{w.label}</span>
                      <span className="text-xs text-subtle">{w.frequency}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Not watched. Case Radar alerts you when this name appears in a new record.</p>
              )}
              <div className="mt-3 flex gap-2">
                {watchKind ? (
                  <Button size="sm" onClick={() => setWatchTarget({ kind: watchKind, label: query, query: { query, entityType: type } })}>
                    <Bell className="h-4 w-4" /> {data.watches.length ? "Add another alert" : "Watch this name"}
                  </Button>
                ) : null}
                <ButtonLink size="sm" variant="secondary" href="/app/radar">
                  Manage alerts
                </ButtonLink>
              </div>
            </Panel>
            <Panel title="Saved research" icon={<BookmarkPlus className="h-4 w-4" />}>
              {data.saved.length ? (
                <ul className="space-y-2 text-sm">
                  {data.saved.map((s) => (
                    <li key={s.itemId}>
                      <Link href={`/app/projects/${s.projectId}`} className="flex items-center gap-2 hover:text-accent">
                        <Badge>{s.kind.replace("_", " ")}</Badge>
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="text-xs text-subtle">{s.projectName}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nothing saved about this name yet.</p>
              )}
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={() => setSaveTarget({ kind: "entity", title: query, ref: { query, entityType: type, records: hits.length } })}>
                  <BookmarkPlus className="h-4 w-4" /> Save profile to a project
                </Button>
              </div>
            </Panel>
          </div>
        ) : null}
      </div>

      <SaveToProjectDialog target={saveTarget} onClose={() => setSaveTarget(null)} signedIn={signedIn} />
      <WatchDialog target={watchTarget} onClose={() => setWatchTarget(null)} signedIn={signedIn} />
      <UpgradeDialog feature={upgrade} onClose={() => setUpgrade(null)} signedIn={signedIn} />
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded bg-elev-2 px-1 text-[11px] tabular-nums text-subtle">{n}</span>;
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-2xl border border-line bg-elev p-3 shadow-card">
      <div className="text-[11px] uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", !value && "text-base font-normal italic text-subtle")}>{value ?? "Unknown"}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-elev p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon ? <span className="text-subtle">{icon}</span> : null}
        {title}
      </div>
      {children}
    </section>
  );
}

function LockedLine({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-left text-xs text-muted hover:text-fg">
      <Lock className="h-3.5 w-3.5 shrink-0" /> {text}
    </button>
  );
}

function MiniList({ title, rows, total }: { title: string; rows: { label: string; count: number }[]; total: number }) {
  return (
    <div>
      {title ? <SectionLabel className="mb-2">{title}</SectionLabel> : null}
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{r.label}</span>
                <span className="tabular-nums text-muted">{r.count}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-elev-2">
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${total ? Math.max(4, (r.count / total) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-subtle">None</p>
      )}
    </div>
  );
}

function YearBars({ data }: { data: { year: number; count: number }[] }) {
  if (!data.length) return <p className="text-sm text-muted">No dated records.</p>;
  const min = data[0].year;
  const max = data[data.length - 1].year;
  const all = Array.from({ length: max - min + 1 }, (_, i) => ({ year: min + i, count: data.find((d) => d.year === min + i)?.count ?? 0 }));
  const peak = Math.max(...all.map((d) => d.count));
  const labelEvery = Math.ceil(all.length / 10);
  return (
    <div>
      <div className="flex h-32 items-end gap-1" role="img" aria-label="Records per year">
        {all.map((d) => (
          <div key={d.year} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.year}: ${d.count}`}>
            <div className={cn("w-full rounded-t", d.count ? "bg-accent/80 group-hover:bg-accent" : "bg-elev-2")} style={{ height: `${d.count ? Math.max(6, (d.count / peak) * 100) : 3}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] tabular-nums text-subtle">
        {all.map((d, i) => (
          <div key={d.year} className="flex-1 text-center">
            {i % labelEvery === 0 || i === all.length - 1 ? `’${String(d.year).slice(2)}` : ""}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-subtle">By each record&apos;s filing or decision date. Reflects retrieved records, not all litigation.</p>
    </div>
  );
}

function RecordLink({ hit }: { hit: SearchHit }) {
  const r = hit.record;
  const href = r.providerDocketId && r.kinds.includes("docket") ? `/docket/${r.providerDocketId}` : r.opinions[0] ? `/case/${r.opinions[0].clusterId}` : r.providerDocketId ? `/docket/${r.providerDocketId}` : null;
  const date = r.dateFiled ?? r.opinions[0]?.dateFiled ?? r.documents[0]?.date ?? null;
  const inner = (
    <>
      <div className="font-medium leading-snug group-hover:text-accent">{r.caseName}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
        <span>{r.court.citation ?? r.court.name}</span>
        {r.docketNumber ? <span className="font-mono">{r.docketNumber}</span> : null}
        {date ? <span>{formatDate(date)}</span> : null}
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="group block">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

function CaseRows({ hits }: { hits: SearchHit[] }) {
  if (!hits.length) return <EmptyState title="No records">Nothing matches this view.</EmptyState>;
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-elev shadow-card">
      {hits.map((h) => (
        <div key={h.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <RecordLink hit={h} />
          </div>
          <div className="flex flex-wrap gap-1">
            {h.match.types.map((t) => (
              <Badge key={t} tone={MATCH_META[t].tone}>
                {MATCH_META[t].label}
              </Badge>
            ))}
            {h.record.kinds.map((k) => (
              <Badge key={k}>{KIND_LABEL[k]}</Badge>
            ))}
            {h.match.partyRole ? <Badge tone="neutral">{h.match.partyRole}</Badge> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function MentionBlock({ doc }: { doc: DocumentHit }) {
  return (
    <div className="rounded-xl border border-amber/25 bg-amber-soft/40 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-subtle">
        <Quote className="h-3.5 w-3.5 text-amber" />
        <span className="font-medium text-muted">{doc.title}</span>
        {doc.date ? <span>· {formatDate(doc.date)}</span> : null}
        {doc.url ? (
          <a href={doc.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">
            Source <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      {doc.snippet ? <Snippet snippet={doc.snippet} className="text-sm leading-relaxed" /> : <p className="text-xs text-subtle">No excerpt available from the source.</p>}
    </div>
  );
}

function TallyTable({ rows, icon, empty, onFocus, detail, note }: { rows: Tally[]; icon: React.ReactNode; empty: string; onFocus: (label: string, keys: string[]) => void; detail?: (t: Tally) => string; note?: string }) {
  if (!rows.length) return <EmptyState icon={icon} title={empty} />;
  const max = rows[0].count;
  return (
    <div>
      <div className="divide-y divide-line rounded-2xl border border-line bg-elev shadow-card">
        {rows.map((t) => (
          <button key={t.key} onClick={() => onFocus(t.label, t.recordKeys)} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elev-2">
            <span className="text-subtle">{icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm group-hover:text-accent">{t.label}</span>
              {detail ? <span className="block truncate text-xs text-subtle">{detail(t)}</span> : null}
            </span>
            <span className="hidden w-24 sm:block">
              <span className="block h-1 overflow-hidden rounded-full bg-elev-2">
                <span className="block h-full rounded-full bg-accent/70" style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
            </span>
            <span className="w-16 text-right text-sm tabular-nums text-muted">
              {plural(t.count, "case", "cases")}
            </span>
          </button>
        ))}
      </div>
      {note ? <p className="mt-2 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}
