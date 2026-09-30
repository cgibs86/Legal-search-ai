"use client";

import { useState } from "react";
import { AlertTriangle, BookmarkPlus, ExternalLink, Sparkles } from "lucide-react";
import type { CaseBrief } from "@/lib/brief/validate";
import { INSUFFICIENT } from "@/lib/brief/validate";
import { api, ApiError } from "@/lib/client/api";
import { Button, Notice, Skeleton } from "@/components/ui/primitives";
import { GateNotice } from "@/components/workspace/dialogs";
import { formatDate } from "@/lib/utils";

/**
 * AI CASE BRIEF — each statement is rendered with the numbered sources it cites.
 * Sections without supported statements show "Insufficient source information."
 */
export function BriefPanel({ kind, id, enabled, onUpgrade, onSave }: { kind: "docket" | "case"; id: string; enabled: boolean; onUpgrade: () => void; onSave?: (brief: CaseBrief) => void }) {
  const [brief, setBrief] = useState<CaseBrief | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!enabled) return onUpgrade();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ brief: CaseBrief | null; message?: string }>("/api/brief", { method: "POST", json: { kind, id } });
      setBrief(res.brief);
      setMessage(res.message ?? null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-elev p-4 shadow-card sm:p-5" aria-label="AI Case Brief">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-violet" /> AI Case Brief
        </div>
        <span className="text-xs text-subtle">Grounded only in this record&apos;s sources</span>
        <div className="ml-auto flex gap-2">
          {brief && onSave ? (
            <Button size="sm" variant="secondary" onClick={() => onSave(brief)}>
              <BookmarkPlus className="h-3.5 w-3.5" /> Save
            </Button>
          ) : null}
          {!brief ? (
            <Button size="sm" onClick={generate} loading={loading}>
              {enabled ? "Generate brief" : "Unlock AI Case Brief"}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <div className="mt-3">{error.needsUpgrade ? <GateNotice error={error} /> : <Notice tone="rose" title="Brief unavailable">{error.message}</Notice>}</div> : null}
      {message ? <Notice className="mt-3" title="Insufficient source information.">{message}</Notice> : null}
      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
            </div>
          ))}
          <p className="text-xs text-subtle">Reading the docket and cited filings…</p>
        </div>
      ) : null}
      {brief ? (
        <div className="mt-4 space-y-5">
          {brief.sections.map((s) => (
            <div key={s.key}>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">{s.title}</h4>
              {s.insufficient ? (
                <p className="mt-1 text-sm italic text-subtle">{INSUFFICIENT}</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {s.statements.map((st, i) => (
                    <li key={i} className="text-sm leading-relaxed text-fg/95">
                      {st.text}{" "}
                      {st.sources.map((src) => (
                        <a key={src.id} href={src.url ?? undefined} target="_blank" rel="noreferrer" title={src.label} className="ml-0.5 inline-flex -translate-y-0.5 items-center rounded bg-accent-soft px-1 font-mono text-[10px] font-semibold text-accent hover:opacity-80">
                          {src.id}
                        </a>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <details className="rounded-xl bg-elev-2 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-muted">Sources ({brief.sources.length})</summary>
            <ol className="mt-2 space-y-1">
              {brief.sources.map((s) => (
                <li key={s.id} className="flex gap-2 text-muted">
                  <span className="font-mono text-accent">{s.id}</span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-accent">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
          <div className="flex items-start gap-2 text-[11px] text-subtle">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {brief.disclaimer} Generated {formatDate(brief.generatedAt)}.{brief.droppedStatements ? ` ${brief.droppedStatements} unsupported statement(s) were removed automatically.` : ""}
            </span>
          </div>
        </div>
      ) : !loading && !error && !message ? (
        <p className="mt-2 text-sm text-muted">A plain-English explanation — what the case is, who the parties are, posture, key filings and rulings — where every sentence links to the docket entry or document it came from.</p>
      ) : null}
    </section>
  );
}
