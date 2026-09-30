"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Briefcase, Building2, FileText, Hash, Search, User, Users } from "lucide-react";
import { classifyQuery, ENTITY_LABELS } from "@/lib/search/classify";
import type { EntityType } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { track } from "@/lib/client/api";

const ICONS: Record<EntityType, typeof User> = {
  person: User,
  company: Building2,
  attorney: Briefcase,
  law_firm: Users,
  case: FileText,
  docket_number: Hash,
  unknown: Search,
};

const PLACEHOLDERS = ["Search a person, company, attorney, or docket…", "e.g. Epic Games", "e.g. 4:20-cv-05640", "e.g. Gary Bornstein"];

export function buildSearchUrl(q: string, type?: EntityType | null, mode?: "universal" | "docket", extra?: URLSearchParams) {
  const p = new URLSearchParams(extra ?? undefined);
  p.set("q", q.trim());
  if (type) p.set("type", type);
  else p.delete("type");
  if (mode === "docket") p.set("mode", "docket");
  else p.delete("mode");
  p.delete("page");
  return `/search?${p.toString()}`;
}

export function SearchBar({
  initialQuery = "",
  initialType = null,
  mode = "universal",
  size = "lg",
  autoFocus,
  onSubmitted,
  className,
}: {
  initialQuery?: string;
  initialType?: EntityType | null;
  mode?: "universal" | "docket";
  size?: "lg" | "md";
  autoFocus?: boolean;
  onSubmitted?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setQ(initialQuery), [initialQuery]);
  useEffect(() => {
    if (q) return;
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length), 3200);
    return () => clearInterval(t);
  }, [q]);

  const suggestions = useMemo(() => {
    const v = q.trim();
    if (v.length < 2) return [];
    const c = classifyQuery(v);
    const list = c.candidates.slice(0, 4).map((x) => ({ type: x.type, reason: x.reason }));
    if (mode !== "docket" && !list.some((x) => x.type === "docket_number") && /\d/.test(v)) list.push({ type: "docket_number", reason: "Search as a docket number" });
    return list;
  }, [q, mode]);

  function submit(type?: EntityType | null) {
    const v = q.trim();
    if (v.length < 2) {
      inputRef.current?.focus();
      return;
    }
    track("search_started", { source: "search_bar" });
    router.push(buildSearchUrl(v, type ?? initialType, mode));
    setFocused(false);
    onSubmitted?.();
  }

  const showSuggest = focused && suggestions.length > 0;

  return (
    <div className={cn("relative w-full", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(showSuggest && active > 0 ? suggestions[active - 1]?.type : undefined);
        }}
        className={cn(
          "group relative flex items-center gap-2 rounded-2xl border border-line-strong bg-elev shadow-card transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-soft",
          size === "lg" ? "h-16 pl-5 pr-2 sm:h-[68px]" : "h-12 pl-4 pr-1.5",
        )}
      >
        <Search className={cn("shrink-0 text-subtle", size === "lg" ? "h-5 w-5" : "h-4 w-4")} aria-hidden />
        <input
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (!showSuggest) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(suggestions.length, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
          }}
          placeholder={mode === "docket" ? "Docket number or case name, e.g. 4:20-cv-05640" : PLACEHOLDERS[placeholderIdx]}
          aria-label="Search court records"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={160}
          className={cn("h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle", size === "lg" ? "text-base sm:text-lg" : "text-[15px]")}
        />
        <button
          type="submit"
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent font-medium text-accent-fg transition hover:bg-accent-hover active:scale-[0.98]",
            size === "lg" ? "h-12 px-4 sm:px-5" : "h-9 px-3.5 text-sm",
          )}
        >
          <span className="hidden sm:inline">Search</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <AnimatePresence>
        {showSuggest ? (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-line bg-elev p-1.5 shadow-float"
            role="listbox"
          >
            <li className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">Search as</li>
            {suggestions.map((s, i) => {
              const Icon = ICONS[s.type];
              return (
                <li key={s.type} role="option" aria-selected={active === i + 1}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => submit(s.type)}
                    onMouseEnter={() => setActive(i + 1)}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm", active === i + 1 ? "bg-elev-2" : "")}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-fg">
                        {ENTITY_LABELS[s.type]} <span className="text-muted">· “{q.trim()}”</span>
                      </span>
                      <span className="block truncate text-xs text-subtle">{s.reason}</span>
                    </span>
                    {i === 0 ? <span className="text-[11px] text-subtle">Enter</span> : null}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
