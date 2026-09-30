"use client";

import { useState } from "react";
import { MessageSquareText, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import type { AskAnswer } from "@/lib/ask/parse";
import { Badge, Button, Notice } from "@/components/ui/primitives";
import type { SearchHit } from "@/lib/domain/types";

const EXAMPLES = ["Which of these cases are still active?", "Show cases filed in California", "Where was this company a defendant?", "Which matters involved the same attorney?", "Show cases after 2022"];

/** Questions run as structured filters over the retrieved records — never as free-form answers. */
export function AskPanel({ searchBody, hits, onApply }: { searchBody: Record<string, unknown>; hits: SearchHit[]; onApply: (ids: string[] | null, label: string | null) => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(hits.map((h) => [h.id, h]));

  async function ask(q: string) {
    if (q.trim().length < 3) return;
    setQuestion(q);
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ answer: AskAnswer }>("/api/ask", { method: "POST", json: { ...searchBody, question: q } });
      setAnswer(res.answer);
      if (res.answer.understood && !res.answer.groups.length) onApply(res.answer.matchingIds, q);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-elev p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquareText className="h-4 w-4 text-accent" /> Ask your results
      </div>
      <p className="mt-1 text-xs text-muted">Questions are answered by filtering the records retrieved for this search — not from general knowledge.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Which of these cases are still active?" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-elev-2 px-3 text-sm outline-none focus:border-accent" maxLength={300} aria-label="Question about these results" />
        <Button type="submit" loading={loading}>
          Ask
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => void ask(ex)} className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:border-line-strong hover:text-fg">
            {ex}
          </button>
        ))}
      </div>
      {error ? <Notice tone="rose" className="mt-3">{error}</Notice> : null}
      {answer ? (
        <div className="mt-4 space-y-3">
          <div className="text-sm font-medium">{answer.answer}</div>
          {answer.interpretation.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-subtle">Interpreted as</span>
              {answer.interpretation.map((i) => (
                <Badge key={i} tone="accent">{i}</Badge>
              ))}
              {answer.usedAI ? (
                <Badge tone="violet">
                  <Sparkles className="h-3 w-3" /> AI-translated filter
                </Badge>
              ) : null}
            </div>
          ) : null}
          {answer.groups.length ? (
            <ul className="space-y-2">
              {answer.groups.map((g) => (
                <li key={g.label} className="rounded-xl bg-elev-2 p-3">
                  <button onClick={() => onApply(g.ids, g.label)} className="text-left text-sm font-semibold hover:text-accent">
                    {g.label} · {g.ids.length} matters
                  </button>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {g.ids.slice(0, 6).map((id) => (
                      <li key={id} className="truncate">{byId.get(id)?.record.caseName ?? id}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}
          {answer.notes.map((n) => (
            <p key={n} className="text-xs text-subtle">{n}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
