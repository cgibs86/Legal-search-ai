"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, BookmarkPlus, ExternalLink, FileText, Lock, RefreshCw } from "lucide-react";
import type { CaseRecord } from "@/lib/domain/types";
import type { FeatureKey } from "@/lib/config/plans";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, ButtonLink, Notice, Skeleton } from "@/components/ui/primitives";
import { BriefPanel } from "@/components/brief/BriefPanel";
import { SaveToProjectDialog, UpgradeDialog, WatchDialog, type SaveTarget, type WatchTarget } from "@/components/workspace/dialogs";
import { cn, formatDate } from "@/lib/utils";

interface CaseResponse {
  record: CaseRecord;
  excerpt: { title: string; text: string; truncated: boolean; url: string | null } | null;
  usage: { used: number | null; limit: number | null };
}

/** Opinion (case law) record: a court decision, labelled as such, with an excerpt and the AI Case Brief. */
export function CaseViewer({ id, features, signedIn }: { id: string; features: Record<FeatureKey, boolean>; signedIn: boolean }) {
  const [data, setData] = useState<CaseResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [watchTarget, setWatchTarget] = useState<WatchTarget | null>(null);
  const [upgrade, setUpgrade] = useState<FeatureKey | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api<CaseResponse>(`/api/case/${id}`)
      .then(setData)
      .catch((e) => setError(e as ApiError));
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {error.needsUpgrade ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold">{error.code === "limit" ? "Monthly record views used" : "Unlock full case records"}</h1>
            <p className="text-muted">{error.message}</p>
            <div className="flex justify-center gap-2">
              <ButtonLink href={signedIn ? "/pricing" : `/signup?next=/case/${id}`}>{signedIn ? "See plans" : "Create account"}</ButtonLink>
              <ButtonLink href="/search" variant="secondary">Back to search</ButtonLink>
            </div>
          </div>
        ) : (
          <Notice tone="rose" title={error.code === "not_found" ? "Decision not found" : "Could not load this decision"} action={<Button size="sm" variant="secondary" onClick={() => location.reload()}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>}>
            {error.message}
          </Notice>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const r = data.record;
  const op = r.opinions[0];
  const live = r.sources.every((s) => s.live);
  const sourceUrl = r.sources[0]?.url ?? null;
  // PDF-derived text keeps the court's hard line wraps; join lines within a paragraph for reading.
  const text = (data.excerpt?.text ?? "").replace(/([^\n])\n(?!\n)/g, "$1 ");
  const shown = expanded ? text : text.slice(0, 2400);

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/search"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        onClick={(e) => {
          if (history.length > 1) {
            e.preventDefault();
            history.back();
          }
        }}
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <header className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="violet">Court decision</Badge>
          {op?.status ? <Badge>{op.status}</Badge> : null}
          {!live ? <Badge tone="amber">Demo snapshot — not live</Badge> : null}
          {data.usage.limit ? <span className="ml-auto text-xs text-subtle">{data.usage.used ?? "—"} of {data.usage.limit} detailed views used this month</span> : null}
        </div>
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{r.caseName}</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
          <span>{r.court.name}</span>
          {r.docketNumber ? <span className="font-mono">{r.docketNumber}</span> : null}
          {r.citations.length ? <span className="font-mono">{r.citations.join(" · ")}</span> : null}
        </div>
        <p className="text-xs text-subtle">
          A published or unpublished decision describes the court&apos;s reasoning at that stage. Later proceedings (rehearing, remand, further appeals) may change the outcome — check the docket.
        </p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-line bg-elev p-4 shadow-card sm:grid-cols-4">
        {[
          ["Decided", op?.dateFiled ? formatDate(op.dateFiled) : null],
          ["Appeal docketed", r.dateFiled ? formatDate(r.dateFiled) : null],
          ["Judges", r.judge],
          ["Opinion type", op?.type ? op.type.replace(/^\d+/, "") : null],
        ].map(([label, value]) => (
          <div key={label as string} className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-subtle">{label}</div>
            <div className={cn("truncate text-sm", value ? "text-fg" : "italic text-subtle")} title={(value as string) ?? undefined}>
              {value ?? "Not in source"}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {r.providerDocketId ? (
          <ButtonLink size="sm" href={`/docket/${r.providerDocketId}`}>
            <FileText className="h-4 w-4" /> Open docket
          </ButtonLink>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setSaveTarget({ kind: "case", title: r.caseName, ref: { clusterId: id, recordKey: r.key, court: r.court.citation ?? r.court.name, citations: r.citations, url: sourceUrl } })}>
          <BookmarkPlus className="h-4 w-4" /> Save to project
        </Button>
        {r.providerDocketId ? (
          <Button size="sm" variant="secondary" onClick={() => setWatchTarget({ kind: "docket", label: r.caseName, query: { docketId: r.providerDocketId!, recordKey: r.key } })}>
            <Bell className="h-4 w-4" /> Watch docket
          </Button>
        ) : null}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted hover:text-fg">
            Source opinion <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {op?.downloadUrl ? (
          <a href={op.downloadUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted hover:text-fg">
            Court PDF <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      <div className="mt-6">
        <BriefPanel
          kind="case"
          id={id}
          enabled={features.aiCaseBrief}
          onUpgrade={() => setUpgrade("aiCaseBrief")}
          onSave={(brief) => setSaveTarget({ kind: "ai_summary", title: `AI Case Brief — ${r.caseName}`, ref: { clusterId: id, recordKey: r.key, brief } })}
        />
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-elev p-4 shadow-card sm:p-5" aria-label="Opinion text">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Opinion text</h2>
          <span className="text-xs text-subtle">Source text, unedited{data.excerpt?.truncated || !live ? " · excerpt" : ""}</span>
        </div>
        {text ? (
          <>
            <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-fg/90">{shown}</div>
            {text.length > shown.length || expanded ? (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Show less" : "Show more of the excerpt"}
              </Button>
            ) : null}
            {data.excerpt?.truncated || !live ? (
              <p className="mt-3 text-xs text-subtle">
                This is an excerpt.{" "}
                {sourceUrl ? (
                  <a className="text-accent hover:underline" href={sourceUrl} target="_blank" rel="noreferrer">
                    Read the full opinion at the source
                  </a>
                ) : null}
                .
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm italic text-subtle">The source has no text for this opinion. Use the source link or court PDF.</p>
        )}
      </section>

      <SaveToProjectDialog target={saveTarget} onClose={() => setSaveTarget(null)} signedIn={signedIn} />
      <WatchDialog target={watchTarget} onClose={() => setWatchTarget(null)} signedIn={signedIn} />
      <UpgradeDialog feature={upgrade} onClose={() => setUpgrade(null)} signedIn={signedIn} />
    </div>
  );
}
