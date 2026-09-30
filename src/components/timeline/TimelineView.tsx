"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";
import type { Timeline, TimelineEvent, TimelineEventKind } from "@/lib/timeline/build";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Notice, Skeleton } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

const KIND: Record<TimelineEventKind, { label: string; tone: "accent" | "cyan" | "amber" | "emerald" | "rose" | "violet" | "neutral" }> = {
  case_filed: { label: "Filed", tone: "cyan" },
  case_terminated: { label: "Terminated", tone: "neutral" },
  decision: { label: "Decision", tone: "violet" },
  appeal: { label: "Appeal", tone: "violet" },
  filing: { label: "Filing", tone: "accent" },
  order: { label: "Order", tone: "amber" },
  judgment: { label: "Judgment", tone: "rose" },
  hearing: { label: "Hearing", tone: "emerald" },
  docket_entry: { label: "Entry", tone: "neutral" },
  mention: { label: "Mention", tone: "amber" },
};
const DOT: Record<string, string> = { accent: "bg-accent", cyan: "bg-cyan", amber: "bg-amber", emerald: "bg-emerald", rose: "bg-rose", violet: "bg-violet", neutral: "bg-subtle" };

type Zoom = { level: "year" } | { level: "month"; year: string } | { level: "day"; year: string; month: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TimelineChart({ events, undatedCount = 0 }: { events: TimelineEvent[]; undatedCount?: number }) {
  const [zoom, setZoom] = useState<Zoom>({ level: "year" });
  const [kinds, setKinds] = useState<Set<TimelineEventKind>>(new Set());
  const filtered = useMemo(() => (kinds.size ? events.filter((e) => kinds.has(e.kind)) : events), [events, kinds]);

  const buckets = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of filtered) {
      let key: string | null = null;
      if (zoom.level === "year") key = e.date.slice(0, 4);
      else if (zoom.level === "month" && e.date.startsWith(zoom.year)) key = e.date.slice(0, 7);
      else if (zoom.level === "day" && e.date.startsWith(`${zoom.year}-${zoom.month}`)) key = e.date.slice(0, 10);
      if (key) map.set(key, [...(map.get(key) ?? []), e]);
    }
    if (zoom.level === "year" && map.size) {
      const years = [...map.keys()].map(Number);
      for (let y = Math.min(...years); y <= Math.max(...years); y++) if (!map.has(String(y))) map.set(String(y), []);
    }
    if (zoom.level === "month") for (let m = 1; m <= 12; m++) if (!map.has(`${zoom.year}-${String(m).padStart(2, "0")}`)) map.set(`${zoom.year}-${String(m).padStart(2, "0")}`, []);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, zoom]);
  const max = Math.max(1, ...buckets.map(([, v]) => v.length));
  const windowEvents = buckets.flatMap(([, v]) => v).sort((a, b) => b.date.localeCompare(a.date));
  const presentKinds = [...new Set(events.map((e) => e.kind))];

  function label(key: string) {
    if (zoom.level === "year") return key;
    if (zoom.level === "month") return MONTHS[Number(key.slice(5, 7)) - 1];
    return String(Number(key.slice(8, 10)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {zoom.level !== "year" ? (
          <button onClick={() => setZoom(zoom.level === "day" ? { level: "month", year: zoom.year } : { level: "year" })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-medium text-muted hover:text-fg">
            <ChevronLeft className="h-3.5 w-3.5" /> {zoom.level === "day" ? zoom.year : "All years"}
          </button>
        ) : null}
        <div className="text-sm font-semibold">{zoom.level === "year" ? "All years" : zoom.level === "month" ? zoom.year : `${MONTHS[Number(zoom.month) - 1]} ${zoom.year}`}</div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {presentKinds.map((k) => (
            <button
              key={k}
              onClick={() => setKinds((s) => {
                const n = new Set(s);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })}
              aria-pressed={kinds.has(k)}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium", kinds.has(k) ? "border-accent text-accent" : "border-line text-muted")}
            >
              <span className={cn("h-2 w-2 rounded-full", DOT[KIND[k].tone])} /> {KIND[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-2" style={{ scrollSnapType: "x proximity" }}>
        <div className="flex min-w-full items-end gap-1.5" style={{ height: 150 }}>
          {buckets.map(([key, list]) => {
            const clickable = list.length > 0 && zoom.level !== "day";
            return (
              <button
                key={key}
                disabled={!clickable}
                onClick={() => (zoom.level === "year" ? setZoom({ level: "month", year: key }) : zoom.level === "month" ? setZoom({ level: "day", year: key.slice(0, 4), month: key.slice(5, 7) }) : undefined)}
                className={cn("group flex h-full min-w-[38px] flex-1 flex-col items-center justify-end gap-1.5", clickable && "cursor-pointer")}
                style={{ scrollSnapAlign: "start" }}
                aria-label={`${label(key)}: ${list.length} events`}
              >
                <div className="flex w-full flex-col-reverse items-center gap-[3px]" style={{ height: `${(list.length / max) * 110}px`, minHeight: list.length ? 8 : 2 }}>
                  {list.length ? (
                    list.slice(0, 18).map((e) => <span key={e.id} className={cn("h-1.5 w-full max-w-[28px] rounded-full opacity-80 transition group-hover:opacity-100", DOT[KIND[e.kind].tone])} />)
                  ) : (
                    <span className="h-0.5 w-full max-w-[28px] rounded-full bg-line" />
                  )}
                </div>
                <span className={cn("text-[11px] tabular-nums", list.length ? "text-muted" : "text-subtle/60")}>{label(key)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <ol className="relative space-y-3 border-l border-line pl-5">
        {windowEvents.slice(0, 60).map((e) => (
          <li key={e.id} className="relative">
            <span className={cn("absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-bg", DOT[KIND[e.kind].tone])} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
              <span className="font-mono text-muted">{formatDate(e.date)}</span>
              <Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge>
              <span className="truncate">{e.court}</span>
            </div>
            <div className="mt-0.5 text-sm font-medium">{e.title} · <span className="font-normal text-muted">{e.caseName}</span></div>
            {e.detail ? <div className="mt-0.5 line-clamp-2 text-sm text-muted">{e.detail}</div> : null}
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                Source <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </li>
        ))}
        {windowEvents.length > 60 ? <li className="text-xs text-subtle">+{windowEvents.length - 60} more — zoom in to see them.</li> : null}
      </ol>
      {undatedCount ? <p className="text-xs text-subtle">{undatedCount} record(s) have no dates in the source and are not placed on the timeline.</p> : null}
    </div>
  );
}

export function EntityTimeline({ searchBody }: { searchBody: unknown }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    let c = false;
    setData(null);
    setError(null);
    api<{ timeline: Timeline }>("/api/timeline", { method: "POST", json: searchBody })
      .then((d) => !c && setData(d.timeline))
      .catch((e) => !c && setError(e as ApiError));
    return () => {
      c = true;
    };
  }, [searchBody]);
  if (error) return <Notice tone="rose" title="Timeline unavailable">{error.message}</Notice>;
  if (!data) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (!data.events.length) return <Notice title="No dated events">None of these records include dates.</Notice>;
  return (
    <div className="rounded-2xl border border-line bg-elev p-4 shadow-card sm:p-5">
      <TimelineChart events={data.events} undatedCount={data.undated.length} />
      <p className="mt-4 text-xs text-subtle">
        Built only from dates in the records. <Link href="/coverage" className="underline">Coverage varies by source.</Link>
      </p>
    </div>
  );
}
