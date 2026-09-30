"use client";

import { Lock, RotateCcw } from "lucide-react";
import type { CaseCategory, MatchType, RecordKind, ResultSummary, SearchFilters, SortOrder } from "@/lib/domain/types";
import { Input, Select } from "@/components/ui/primitives";
import { CATEGORY_LABEL, MATCH_META } from "@/lib/ui/labels";
import { cn } from "@/lib/utils";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR","GU","VI"];

function Chip({ active, onClick, children, tone }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition",
        active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-fg",
        tone,
      )}
    >
      {children}
    </button>
  );
}

function Group({ title, children, locked }: { title: string; children: React.ReactNode; locked?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">
        {title} {locked ? <Lock className="h-3 w-3" /> : null}
      </legend>
      <div className={cn(locked && "pointer-events-none opacity-50")}>{children}</div>
    </fieldset>
  );
}

function toggle<T>(list: T[] | undefined, v: T): T[] | undefined {
  const s = new Set(list ?? []);
  if (s.has(v)) s.delete(v);
  else s.add(v);
  return s.size ? [...s] : undefined;
}

export function Filters({
  filters,
  sort,
  onChange,
  onSort,
  summary,
  advanced,
  mode,
}: {
  filters: SearchFilters;
  sort: SortOrder;
  onChange: (f: SearchFilters) => void;
  onSort: (s: SortOrder) => void;
  summary: ResultSummary | null;
  advanced: boolean;
  mode: "universal" | "docket";
}) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });
  const active = Object.values(filters).filter((v) => v !== undefined && (!Array.isArray(v) || v.length)).length;
  const courtOptions = summary?.courts ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Filters {active ? <span className="text-accent">({active})</span> : null}</div>
        {active ? (
          <button onClick={() => onChange({})} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        ) : null}
      </div>

      <Group title="Sort">
        <div className="flex flex-wrap gap-1.5">
          {(["relevance", "newest", "oldest"] as SortOrder[]).map((s) => (
            <Chip key={s} active={sort === s} onClick={() => onSort(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </Chip>
          ))}
        </div>
      </Group>

      {mode === "universal" ? (
        <Group title="Match type">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MATCH_META) as MatchType[]).map((t) => (
              <Chip key={t} active={Boolean(filters.matchTypes?.includes(t))} onClick={() => set({ matchTypes: toggle(filters.matchTypes, t) })}>
                {MATCH_META[t].label}
                {summary ? <span className="text-subtle">{summary.byMatchType[t]}</span> : null}
              </Chip>
            ))}
          </div>
        </Group>
      ) : null}

      {mode === "universal" ? (
        <Group title="Record type">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["docket", "Docket"],
              ["opinion", "Opinion"],
              ["filing", "Filing"],
            ] as [RecordKind, string][]).map(([k, label]) => (
              <Chip key={k} active={Boolean(filters.recordKinds?.includes(k))} onClick={() => set({ recordKinds: toggle(filters.recordKinds, k) })}>
                {label}
              </Chip>
            ))}
          </div>
        </Group>
      ) : null}

      <Group title="Party">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filters.partyKind === "company"} onClick={() => set({ partyKind: filters.partyKind === "company" ? undefined : "company" })}>
            Company
          </Chip>
          <Chip active={filters.partyKind === "individual"} onClick={() => set({ partyKind: filters.partyKind === "individual" ? undefined : "individual" })}>
            Individual
          </Chip>
        </div>
      </Group>

      <Group title="Jurisdiction">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filters.jurisdiction === "federal"} onClick={() => set({ jurisdiction: filters.jurisdiction === "federal" ? undefined : "federal" })}>
            Federal
          </Chip>
          <Chip active={filters.jurisdiction === "state"} onClick={() => set({ jurisdiction: filters.jurisdiction === "state" ? undefined : "state" })}>
            State
          </Chip>
        </div>
      </Group>

      <Group title="State">
        <Select value="" onChange={(e) => e.target.value && set({ states: toggle(filters.states, e.target.value) })} aria-label="Add state filter">
          <option value="">Add a state…</option>
          {STATES.filter((s) => !filters.states?.includes(s)).map((s) => (
            <option key={s} value={s}>
              {s}
              {summary?.states.find((x) => x.state === s) ? ` (${summary.states.find((x) => x.state === s)!.count})` : ""}
            </option>
          ))}
        </Select>
        {filters.states?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {filters.states.map((s) => (
              <Chip key={s} active onClick={() => set({ states: toggle(filters.states, s) })}>
                {s} ×
              </Chip>
            ))}
          </div>
        ) : null}
      </Group>

      <Group title="Court / district" locked={!advanced}>
        {courtOptions.length ? (
          <div className="flex flex-wrap gap-1.5">
            {courtOptions.slice(0, 16).map((c) => (
              <Chip key={c.id} active={Boolean(filters.courts?.includes(c.id))} onClick={() => set({ courts: toggle(filters.courts, c.id) })}>
                {c.name} <span className="text-subtle">{c.count}</span>
              </Chip>
            ))}
          </div>
        ) : (
          <div className="text-xs text-subtle">Courts in your results appear here.</div>
        )}
      </Group>

      <Group title="Case type">
        <div className="flex flex-wrap gap-1.5">
          {(["civil", "criminal", "bankruptcy", "appeal"] as CaseCategory[]).map((c) => (
            <Chip key={c} active={Boolean(filters.categories?.includes(c))} onClick={() => set({ categories: toggle(filters.categories, c) })}>
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-subtle">Criminal records appear only where publicly available in federal sources.</p>
      </Group>

      <Group title="Status">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filters.status === "active"} onClick={() => set({ status: filters.status === "active" ? undefined : "active" })}>
            Active
          </Chip>
          <Chip active={filters.status === "closed"} onClick={() => set({ status: filters.status === "closed" ? undefined : "closed" })}>
            Closed
          </Chip>
        </div>
      </Group>

      <Group title="Filing date">
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={filters.filedAfter ?? ""} onChange={(e) => set({ filedAfter: e.target.value || undefined })} aria-label="Filed after" className="h-9" />
          <Input type="date" value={filters.filedBefore ?? ""} onChange={(e) => set({ filedBefore: e.target.value || undefined })} aria-label="Filed before" className="h-9" />
        </div>
      </Group>

      <Group title="Termination date" locked={!advanced}>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={filters.terminatedAfter ?? ""} onChange={(e) => set({ terminatedAfter: e.target.value || undefined })} aria-label="Terminated after" className="h-9" />
          <Input type="date" value={filters.terminatedBefore ?? ""} onChange={(e) => set({ terminatedBefore: e.target.value || undefined })} aria-label="Terminated before" className="h-9" />
        </div>
      </Group>
    </div>
  );
}
