"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, BookmarkPlus, CalendarClock, CheckSquare, Download, ExternalLink, FileText, Lock, RefreshCw, Search, Square, Star, Users } from "lucide-react";
import type { DocketDetail, DocketEntry, DocketEntryCategory } from "@/lib/domain/types";
import type { DiffChange } from "@/lib/docket/diff";
import type { FeatureKey } from "@/lib/config/plans";
import { api, ApiError, downloadPost } from "@/lib/client/api";
import { Badge, Button, ButtonLink, EmptyState, Notice, Skeleton } from "@/components/ui/primitives";
import { Tabs, useToast } from "@/components/ui/overlay";
import { BriefPanel } from "@/components/brief/BriefPanel";
import { TimelineChart } from "@/components/timeline/TimelineView";
import { GateNotice, SaveToProjectDialog, UpgradeDialog, WatchDialog, type SaveTarget, type WatchTarget } from "@/components/workspace/dialogs";
import { docketEntriesToEvents } from "@/lib/timeline/build";
import { CATEGORY_LABEL } from "@/lib/ui/labels";
import { cn, formatDate } from "@/lib/utils";

const CAT: Record<DocketEntryCategory, { label: string; tone: "accent" | "cyan" | "amber" | "emerald" | "rose" | "violet" | "neutral" }> = {
  complaint: { label: "Complaint", tone: "cyan" },
  order: { label: "Order", tone: "amber" },
  judgment: { label: "Judgment", tone: "rose" },
  motion: { label: "Motion", tone: "accent" },
  hearing: { label: "Hearing", tone: "emerald" },
  notice: { label: "Notice", tone: "neutral" },
  appeal: { label: "Appeal", tone: "violet" },
  transcript: { label: "Transcript", tone: "neutral" },
  stipulation: { label: "Stipulation", tone: "neutral" },
  brief: { label: "Brief", tone: "accent" },
  other: { label: "Entry", tone: "neutral" },
};

type Tab = "entries" | "parties" | "timeline" | "brief";

export function DocketViewer({ id, features, signedIn, showDiff }: { id: string; features: Record<FeatureKey, boolean>; signedIn: boolean; showDiff: boolean }) {
  const toast = useToast();
  const [detail, setDetail] = useState<DocketDetail | null>(null);
  const [entries, setEntries] = useState<DocketEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number | null; limit: number | null } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<Tab>("entries");
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Set<DocketEntryCategory>>(new Set());
  const [importantOnly, setImportantOnly] = useState(false);
  const [docsOnly, setDocsOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [watchTarget, setWatchTarget] = useState<WatchTarget | null>(null);
  const [upgrade, setUpgrade] = useState<FeatureKey | null>(null);
  const [diff, setDiff] = useState<{ watching: boolean; message?: string; diff: { since: string; changes: DiffChange[]; hasChanges: boolean } | null } | null>(null);

  useEffect(() => {
    api<{ detail: DocketDetail; usage: { used: number | null; limit: number | null } }>(`/api/docket/${id}`)
      .then((d) => {
        setDetail(d.detail);
        setEntries(d.detail.entries);
        setCursor(d.detail.entriesNextCursor);
        setUsage(d.usage);
      })
      .catch((e) => setError(e as ApiError));
  }, [id]);

  useEffect(() => {
    if (!features.docketDiff || !signedIn) return;
    api<typeof diff>(`/api/docket/${id}/diff`).then(setDiff).catch(() => setDiff(null));
  }, [id, features.docketDiff, signedIn]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const d = await api<{ entries: DocketEntry[]; nextCursor: string | null }>(`/api/docket/${id}/entries?cursor=${encodeURIComponent(cursor)}`);
      setEntries((prev) => [...prev, ...d.entries.filter((e) => !prev.some((p) => p.id === e.id))]);
      setCursor(d.nextCursor);
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => (!cats.size || cats.has(e.category)) && (!importantOnly || e.important) && (!docsOnly || e.documents.some((d) => d.available)) && (!q || e.description.toLowerCase().includes(q) || e.entryNumber === q));
  }, [entries, cats, importantOnly, docsOnly, query]);
  const presentCats = useMemo(() => [...new Set(entries.map((e) => e.category))], [entries]);
  const deadlines = useMemo(() => entries.flatMap((e) => e.deadlines.map((d) => ({ ...d, entry: e }))).filter((d) => d.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date)), [entries]);

  async function exportSelected() {
    if (!features.exports) return setUpgrade("exports");
    try {
      await downloadPost("/api/export", { kind: "docket_entries", format: "csv", docketId: id, entryIds: selected.size ? [...selected] : undefined }, `docket-${id}.csv`);
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {error.needsUpgrade ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold">{error.code === "limit" ? "Monthly record views used" : "Unlock the docket viewer"}</h1>
            <p className="text-muted">{error.message}</p>
            <div className="flex justify-center gap-2">
              <ButtonLink href={signedIn ? "/pricing" : `/signup?next=/docket/${id}`}>{signedIn ? "See plans" : "Create account"}</ButtonLink>
              <ButtonLink href="/search" variant="secondary">Back to search</ButtonLink>
            </div>
          </div>
        ) : (
          <Notice tone="rose" title={error.code === "not_found" ? "Docket not found" : "Could not load this docket"} action={<Button size="sm" variant="secondary" onClick={() => location.reload()}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}>
            {error.message}
          </Notice>
        )}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const r = detail.record;
  const live = r.sources.every((s) => s.live);
  const sourceUrl = r.sources[0]?.url ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <Link href="/search" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg" onClick={(e) => {
        if (history.length > 1) {
          e.preventDefault();
          history.back();
        }
      }}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <header className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="cyan">Docket record</Badge>
          <Badge tone={r.status === "closed" ? "neutral" : r.status === "active" ? "emerald" : "neutral"}>{r.status === "active" ? "Open" : r.status === "closed" ? "Terminated" : "Status unknown"}</Badge>
          {r.category !== "unknown" ? <Badge>{CATEGORY_LABEL[r.category]}</Badge> : null}
          {!live ? <Badge tone="amber">Demo snapshot — not live</Badge> : null}
          {usage?.limit ? <span className="ml-auto text-xs text-subtle">{usage.used ?? "—"} of {usage.limit} detailed views used this month</span> : null}
        </div>
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{r.caseName}</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
          <span>{r.court.name}</span>
          {r.docketNumber ? <span className="font-mono">{r.docketNumber}</span> : null}
        </div>
        <p className="text-xs text-subtle">A docket record lists what was filed. It is not a ruling or judgment unless an entry says so. Filings contain allegations, not proven facts.</p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-line bg-elev p-4 shadow-card sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Filed", r.dateFiled ? formatDate(r.dateFiled) : null],
          ["Terminated", r.dateTerminated ? formatDate(r.dateTerminated) : null],
          ["Last filing", detail.dateLastFiling ? formatDate(detail.dateLastFiling) : null],
          ["Judge", r.judge],
          ["Nature of suit", r.natureOfSuit],
          ["Cause", r.cause],
        ].map(([label, value]) => (
          <div key={label as string} className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-subtle">{label}</div>
            <div className={cn("truncate text-sm", value ? "text-fg" : "italic text-subtle")} title={(value as string) ?? undefined}>
              {value ?? "Unknown"}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setWatchTarget({ kind: "docket", label: r.caseName, query: { docketId: id, recordKey: r.key } })}>
          <Bell className="h-4 w-4" /> Watch docket
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSaveTarget({ kind: "docket", title: r.caseName, ref: { docketId: id, recordKey: r.key, court: r.court.citation ?? r.court.name, docketNumber: r.docketNumber, url: sourceUrl } })}>
          <BookmarkPlus className="h-4 w-4" /> Save to project
        </Button>
        <Button size="sm" variant="secondary" onClick={exportSelected}>
          <Download className="h-4 w-4" /> Export {selected.size ? `${selected.size} selected` : "entries"}
        </Button>
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted hover:text-fg">
            Source docket <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      {diff?.watching ? (
        <section className={cn("mt-5 rounded-2xl border p-4 shadow-card", diff.diff?.hasChanges ? "border-accent/40 bg-accent-soft/40" : "border-line bg-elev")} aria-label="Docket Diff">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Docket Diff</Badge>
            <span className="text-sm font-semibold">{diff.diff?.hasChanges ? "NEW SINCE LAST CHECK" : "No changes since last check"}</span>
            {diff.diff ? <span className="text-xs text-subtle">Last check {formatDate(diff.diff.since, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : null}
          </div>
          {diff.message ? <p className="mt-2 text-sm text-muted">{diff.message}</p> : null}
          {diff.diff?.changes.length ? (
            <ul className="mt-3 space-y-2">
              {diff.diff.changes.slice(0, 20).map((c, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <Badge tone={c.kind === "new_order" ? "amber" : c.kind === "case_closed" ? "rose" : c.kind === "new_deadline" ? "emerald" : "accent"}>{c.kind.replace(/_/g, " ")}</Badge>
                  <span className="min-w-0 flex-1">
                    {c.title}
                    {c.date ? <span className="text-xs text-subtle"> · {formatDate(c.date)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : showDiff && !features.docketDiff ? (
        <Notice className="mt-5" tone="accent" icon={<Lock className="h-4 w-4 text-accent" />} title="Docket Diff is included in Research Pro" action={<Button size="sm" onClick={() => setUpgrade("docketDiff")}>Upgrade</Button>}>
          See only what changed since your last check — new filings, orders, hearings and deadlines.
        </Notice>
      ) : null}

      {deadlines.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald/25 bg-emerald-soft/40 px-4 py-3 text-sm">
          <CalendarClock className="h-4 w-4 text-emerald" />
          <span className="font-medium">Upcoming dates stated in entries:</span>
          {deadlines.slice(0, 4).map((d, i) => (
            <span key={i} className="text-muted">
              {formatDate(d.date)} — {d.text.slice(0, 60)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "entries", label: <><FileText className="h-4 w-4" /> Docket entries</>, badge: <span className="text-xs text-subtle">{entries.length}{cursor ? "+" : ""}</span> },
            { id: "parties", label: <><Users className="h-4 w-4" /> Parties &amp; counsel</>, badge: <span className="text-xs text-subtle">{r.parties.length}</span> },
            { id: "timeline", label: <><CalendarClock className="h-4 w-4" /> Timeline</> },
            { id: "brief", label: <>AI Case Brief</>, badge: !features.aiCaseBrief ? <Lock className="h-3 w-3 text-subtle" /> : null },
          ]}
        />
      </div>

      {tab === "entries" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search docket text or entry number" className="h-10 w-full rounded-xl border border-line bg-elev pl-9 pr-3 text-sm outline-none focus:border-accent" aria-label="Search docket entries" />
            </label>
            <div className="flex gap-1.5">
              <button onClick={() => setImportantOnly((v) => !v)} aria-pressed={importantOnly} className={cn("inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium", importantOnly ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
                <Star className="h-3.5 w-3.5" /> Key entries
              </button>
              <button onClick={() => setDocsOnly((v) => !v)} aria-pressed={docsOnly} className={cn("inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium", docsOnly ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
                <FileText className="h-3.5 w-3.5" /> With documents
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presentCats.map((c) => (
              <button
                key={c}
                onClick={() => setCats((s) => {
                  const n = new Set(s);
                  if (n.has(c)) n.delete(c);
                  else n.add(c);
                  return n;
                })}
                aria-pressed={cats.has(c)}
                className={cn("h-7 rounded-md border px-2 text-[11px] font-medium", cats.has(c) ? "border-accent text-accent" : "border-line text-muted")}
              >
                {CAT[c].label} {entries.filter((e) => e.category === c).length}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <EmptyState title={entries.length ? "No entries match these filters" : "No docket entries available"}>
              {entries.length ? "Clear the filters or search text." : "The source has not captured entries for this docket. Basic case metadata may be all that is available."}
            </EmptyState>
          ) : (
            <ol className="space-y-2">
              {filtered.map((e) => (
                <li key={e.id} className={cn("rounded-2xl border bg-elev p-4 transition", selected.has(e.id) ? "border-accent" : "border-line", e.important && "shadow-card")}>
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        return n;
                      })}
                      className="mt-0.5 text-subtle hover:text-fg"
                      aria-label={selected.has(e.id) ? "Deselect entry" : "Select entry"}
                    >
                      {selected.has(e.id) ? <CheckSquare className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-fg">{e.entryNumber ? `#${e.entryNumber}` : "—"}</span>
                        <span className="text-muted">{e.dateFiled ? formatDate(e.dateFiled) : "Date unknown"}</span>
                        <Badge tone={CAT[e.category].tone}>{CAT[e.category].label}</Badge>
                        {e.important ? <Star className="h-3.5 w-3.5 fill-amber text-amber" aria-label="Key entry" /> : null}
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-fg/90">{e.description}</p>
                      {e.deadlines.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {e.deadlines.map((d, i) => (
                            <Badge key={i} tone="emerald">
                              <CalendarClock className="h-3 w-3" /> {d.text.slice(0, 50)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {e.documents.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {e.documents.map((d) => (
                            <a
                              key={d.id}
                              href={d.downloadUrl ?? d.url ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs", d.available ? "border-line text-fg hover:border-accent" : "border-dashed border-line text-subtle")}
                              title={d.available ? "Open document" : "Not yet in the public archive (may be purchasable on PACER)"}
                            >
                              <FileText className="h-3 w-3" /> {d.title.slice(0, 50)}
                              {d.pageCount ? <span className="text-subtle">· {d.pageCount}p</span> : null}
                              {!d.available ? <span className="text-subtle">· not in archive</span> : null}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button onClick={() => setSaveTarget({ kind: "filing", title: `${r.caseName} — entry ${e.entryNumber ?? ""}`.trim(), ref: { docketId: id, entryId: e.id, date: e.dateFiled, description: e.description.slice(0, 500), url: e.documents[0]?.url ?? sourceUrl } })} className="text-subtle hover:text-fg" aria-label="Save entry">
                      <BookmarkPlus className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {cursor ? (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
                Load older entries
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "parties" ? (
        <div className="mt-4 space-y-3">
          {!detail.partiesDetailed ? <Notice>The source has not captured a full party list for this docket; parties below come from the case caption.</Notice> : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {r.parties.map((p) => {
              const counsel = r.attorneys.filter((a) => a.representing.includes(p.name));
              return (
                <li key={`${p.name}-${p.providerPartyId}`} className="rounded-2xl border border-line bg-elev p-4">
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-0.5 text-xs text-muted">{p.role ?? (p.roleSource === "caption" ? "Named in caption (role not recorded)" : "Role not recorded")}</div>
                  {counsel.length ? (
                    <ul className="mt-2 space-y-0.5 text-xs text-subtle">
                      {counsel.map((a) => (
                        <li key={a.providerAttorneyId ?? a.name}>
                          {a.name}
                          {a.roles.length ? ` — ${a.roles.join(", ")}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-subtle">Contact details of counsel are intentionally not displayed.</p>
        </div>
      ) : null}

      {tab === "timeline" ? (
        <div className="mt-4 rounded-2xl border border-line bg-elev p-4 shadow-card">
          <TimelineChart events={[...docketEntriesToEvents(r.key, r.caseName, r.court.citation ?? r.court.name, entries), ...(r.dateFiled ? [{ id: "filed", date: r.dateFiled, kind: "case_filed" as const, title: "Case filed", detail: null, recordKey: r.key, caseName: r.caseName, court: r.court.citation ?? r.court.name, url: sourceUrl }] : []), ...(r.dateTerminated ? [{ id: "term", date: r.dateTerminated, kind: "case_terminated" as const, title: "Case terminated", detail: null, recordKey: r.key, caseName: r.caseName, court: r.court.citation ?? r.court.name, url: sourceUrl }] : [])]} />
          {cursor ? <p className="mt-3 text-xs text-subtle">Timeline shows the {entries.length} most recent entries loaded. Load older entries to extend it.</p> : null}
        </div>
      ) : null}

      {tab === "brief" ? (
        <div className="mt-4">
          <BriefPanel
            kind="docket"
            id={id}
            enabled={features.aiCaseBrief}
            onUpgrade={() => setUpgrade("aiCaseBrief")}
            onSave={(b) => setSaveTarget({ kind: "ai_summary", title: `AI Case Brief — ${r.caseName}`, ref: { docketId: id, brief: b } })}
          />
        </div>
      ) : null}

      <SaveToProjectDialog target={saveTarget} onClose={() => setSaveTarget(null)} signedIn={signedIn} />
      <WatchDialog target={watchTarget} onClose={() => setWatchTarget(null)} signedIn={signedIn} />
      <UpgradeDialog feature={upgrade} onClose={() => setUpgrade(null)} signedIn={signedIn} />
      {error ? <GateNotice error={error} /> : null}
    </div>
  );
}
