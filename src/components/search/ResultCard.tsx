"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { Bell, Bookmark, ChevronDown, ExternalLink, FileText, Info, Lock, Quote } from "lucide-react";
import type { DeliveredHit, MaskedHit, SearchHit } from "@/lib/domain/types";
import { Badge } from "@/components/ui/primitives";
import { CATEGORY_LABEL, KIND_LABEL, LEVEL_LABEL, MATCH_META } from "@/lib/ui/labels";
import { cn, formatDate } from "@/lib/utils";
import { Snippet, SNIPPET_FIELD_LABEL, SNIPPET_SOURCE_LABEL } from "./Snippet";

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const unknown = value == null || value === "";
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("truncate text-sm", unknown ? "text-subtle italic" : "text-fg", mono && !unknown && "font-mono text-[13px]")}>{unknown ? "Unknown" : value}</div>
    </div>
  );
}

export interface ResultActions {
  onSave?: (hit: SearchHit) => void;
  onWatch?: (hit: SearchHit) => void;
  mentionIntelligence: boolean;
  onUpgrade?: (feature: string) => void;
}

export function ResultCard({ hit, index, actions, highlighted }: { hit: SearchHit; index: number; actions: ResultActions; highlighted?: boolean }) {
  const [open, setOpen] = useState(false);
  const r = hit.record;
  const m = hit.match;
  const live = r.sources.every((s) => s.live);
  const docketId = r.providerDocketId && r.kinds.includes("docket") ? r.providerDocketId : null;
  const opinion = r.opinions[0];
  const mentions = m.mentions.filter((d) => d.snippet);
  const court = r.court.citation ?? r.court.name;
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.03 }}
      className={cn("group rounded-2xl border bg-elev p-4 shadow-card transition hover:border-line-strong sm:p-5", highlighted ? "border-accent ring-2 ring-accent-soft" : "border-line")}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {m.types.map((t) => (
          <Badge key={t} tone={MATCH_META[t].tone} title={MATCH_META[t].description}>
            {MATCH_META[t].label}
          </Badge>
        ))}
        {r.kinds.includes("docket") ? <Badge tone="cyan">Docket record</Badge> : null}
        {r.kinds.includes("opinion") ? <Badge tone="violet">Opinion</Badge> : null}
        {!live ? <Badge tone="amber">Demo snapshot</Badge> : null}
        <span className="ml-auto text-xs text-subtle">{LEVEL_LABEL[r.court.level]}{r.court.state ? ` · ${r.court.state}` : ""}</span>
      </div>

      <h3 className="mt-2.5 text-[17px] font-semibold leading-snug tracking-tight text-fg">
        {docketId ? (
          <Link href={`/docket/${docketId}`} className="hover:text-accent">
            {r.caseName}
          </Link>
        ) : opinion ? (
          <Link href={`/case/${opinion.clusterId}`} className="hover:text-accent">
            {r.caseName}
          </Link>
        ) : (
          r.caseName
        )}
      </h3>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>{court}</span>
        {r.docketNumber ? (
          <>
            <span className="text-subtle">·</span>
            <span className="font-mono text-[13px]">{r.docketNumber}</span>
          </>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Field label="Date filed" value={r.dateFiled ? formatDate(r.dateFiled) : opinion?.dateFiled ? `${formatDate(opinion.dateFiled)} (decision)` : null} />
        <Field label="Status" value={r.status === "unknown" ? null : r.status === "active" ? "Open" : "Terminated"} />
        <Field label="Case type" value={r.category === "unknown" ? null : [CATEGORY_LABEL[r.category], r.natureOfSuit].filter(Boolean).join(" · ")} />
        <Field label="Party role" value={m.partyRole} />
        <Field label="Judge" value={r.judge} />
        <Field label="Matched" value={m.matchedText ? `“${m.matchedText}”` : null} />
        <Field label="Last known activity" value={r.lastActivity ? formatDate(r.lastActivity) : null} />
        <Field label="Terminated" value={r.dateTerminated ? formatDate(r.dateTerminated) : null} />
      </div>

      {m.identityNote ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-elev-2 px-3 py-2 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" />
          {m.identityNote}
        </div>
      ) : null}

      {mentions.length > 0 ? (
        actions.mentionIntelligence ? (
          <div className="mt-3 space-y-2">
            {mentions.slice(0, open ? 5 : 1).map((d) => (
              <div key={d.id} className="rounded-xl border border-amber/25 bg-amber-soft/40 p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-subtle">
                  <Quote className="h-3.5 w-3.5 text-amber" />
                  <span className="font-medium text-muted">{d.title}</span>
                  {d.date ? <span>· {formatDate(d.date)}</span> : null}
                  {d.snippet ? <span>· {SNIPPET_FIELD_LABEL[d.snippet.field]}</span> : null}
                </div>
                {d.snippet ? <Snippet snippet={d.snippet} className="text-sm leading-relaxed text-fg/90" /> : null}
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-subtle">
                  <span>{d.snippet ? SNIPPET_SOURCE_LABEL[d.snippet.source] : ""}</span>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <button onClick={() => actions.onUpgrade?.("mentionIntelligence")} className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-left text-xs text-muted hover:text-fg">
            <Lock className="h-3.5 w-3.5" /> {mentions.length} highlighted mention{mentions.length > 1 ? "s" : ""} in source text — Mention Intelligence is included in Research Pro
          </button>
        )
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-elev-2 hover:text-fg" aria-expanded={open}>
          Why this result matched <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.sources.map((s) => (
            <a key={`${s.provider}-${s.kind}-${s.providerRecordId}`} href={s.url ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-fg" title={`${s.label}${s.indexedAt ? ` · indexed ${s.indexedAt.slice(0, 10)}` : ""}`}>
              <FileText className="h-3 w-3" />
              {s.label.replace("CourtListener ", "")}
              {s.url ? <ExternalLink className="h-2.5 w-2.5" /> : null}
            </a>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {actions.onWatch ? (
            <button onClick={() => actions.onWatch?.(hit)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted hover:bg-elev-2 hover:text-fg" aria-label="Monitor this record">
              <Bell className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Watch</span>
            </button>
          ) : null}
          {actions.onSave ? (
            <button onClick={() => actions.onSave?.(hit)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted hover:bg-elev-2 hover:text-fg" aria-label="Save to project">
              <Bookmark className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Save</span>
            </button>
          ) : null}
          {docketId ? (
            <Link href={`/docket/${docketId}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent-soft px-3 text-xs font-semibold text-accent hover:opacity-90">
              Open docket
            </Link>
          ) : opinion ? (
            <Link href={`/case/${opinion.clusterId}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent-soft px-3 text-xs font-semibold text-accent hover:opacity-90">
              Open decision
            </Link>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-2 rounded-xl bg-elev-2 p-3 text-sm">
          <ul className="space-y-1 text-muted">
            {m.reasons.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-subtle" />
                {x}
              </li>
            ))}
            <li className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-subtle" />
              Name form searched: “{m.matchedVariant}” ({m.variantKind.replace(/_/g, " ")})
            </li>
            <li className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-subtle" />
              {r.statusBasis}
            </li>
            {!r.partyListCaptured && r.kinds.includes("docket") ? (
              <li className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-subtle" />
                The full party list for this docket has not been captured by the source; parties shown come from the caption.
              </li>
            ) : null}
          </ul>
          <div className="text-xs text-subtle">
            Record kinds: {r.kinds.map((k) => KIND_LABEL[k]).join(", ")} · Sources merged: {r.sources.length}
          </div>
        </div>
      ) : null}
    </motion.article>
  );
}

export function LockedResultCard({ hit, index }: { hit: MaskedHit; index: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-elev p-4 shadow-card sm:p-5" aria-label="Locked result">
      <div className="flex flex-wrap items-center gap-1.5">
        {hit.matchTypes.map((t) => (
          <Badge key={t} tone={MATCH_META[t].tone}>
            {MATCH_META[t].label}
          </Badge>
        ))}
        {hit.kinds.includes("docket") ? <Badge tone="cyan">Docket record</Badge> : null}
        {hit.kinds.includes("opinion") ? <Badge tone="violet">Opinion</Badge> : null}
        <span className="ml-auto text-xs text-subtle">
          {LEVEL_LABEL[hit.court.level]}
          {hit.court.state ? ` · ${hit.court.state}` : ""}
          {hit.year ? ` · ${hit.year}` : ""}
        </span>
      </div>
      {hit.basic ? (
        <>
          <h3 className="mt-2.5 text-[17px] font-semibold leading-snug">{hit.basic.caseName}</h3>
          <div className="mt-1 text-sm text-muted">
            {hit.basic.courtName}
            {hit.basic.docketNumber ? <span className="font-mono text-[13px]"> · {hit.basic.docketNumber}</span> : null}
            {hit.basic.dateFiled ? ` · ${formatDate(hit.basic.dateFiled)}` : ""}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
            {["Party role", "Why matched", "Mentions", "Sources"].map((l) => (
              <div key={l}>
                <div className="text-[11px] uppercase tracking-wider text-subtle">{l}</div>
                <div className="mt-1 flex items-center gap-1 text-sm text-subtle">
                  <Lock className="h-3 w-3" /> Locked
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="locked-blur mt-3 space-y-2.5" aria-hidden>
          <div className="h-5 w-3/4 rounded bg-fg/20" />
          <div className="h-3.5 w-1/2 rounded bg-fg/10" />
          <div className="mt-4 grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 w-2/3 rounded bg-fg/10" />
                <div className="h-3.5 w-5/6 rounded bg-fg/15" />
              </div>
            ))}
          </div>
        </div>
      )}
      <span className="sr-only">Result {index + 1} is locked.</span>
    </div>
  );
}

export function isFull(h: DeliveredHit): h is SearchHit {
  return !("masked" in h);
}
