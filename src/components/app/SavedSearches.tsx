"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, Search, Trash2 } from "lucide-react";
import type { SavedSearch } from "@/lib/data/types";
import { api, ApiError } from "@/lib/client/api";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { searchHref } from "@/lib/search/urlParams";
import { relativeTime } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { person: "Person", company: "Company", attorney: "Attorney", law_firm: "Law firm", case: "Case", docket_number: "Docket", unknown: "Name" };

export function SavedSearches({ initial, limit }: { initial: SavedSearch[]; limit: number }) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  async function remove(id: string) {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    try {
      await api(`/api/saved-searches?id=${id}`, { method: "DELETE" });
    } catch (e) {
      setItems(prev);
      toast((e as ApiError).message, "error");
    }
  }
  if (!items.length) {
    return (
      <EmptyState icon={<Bookmark className="h-6 w-6" />} title="No saved searches">
        {limit ? "Run a search and choose “Save search” to re-run it later with the same filters." : "Saved searches are included in every paid plan."}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      <div className="divide-y divide-line rounded-2xl border border-line bg-elev shadow-card">
        {items.map((s) => {
          const filterCount = Object.values(s.filters ?? {}).filter((v) => v !== undefined && !(Array.isArray(v) && !v.length)).length;
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Search className="h-4 w-4 text-subtle" />
              <Link href={searchHref(s.query, s.entityType, s.filters)} className="min-w-0 flex-1 hover:text-accent">
                <div className="truncate font-medium">{s.name}</div>
                <div className="truncate text-xs text-muted">
                  “{s.query}”{filterCount ? ` · ${filterCount} filter${filterCount > 1 ? "s" : ""}` : ""} · saved {relativeTime(s.createdAt)}
                </div>
              </Link>
              <Badge>{TYPE_LABEL[s.entityType] ?? s.entityType}</Badge>
              <button onClick={() => remove(s.id)} className="rounded p-1.5 text-subtle hover:text-rose" aria-label={`Delete ${s.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-subtle">
        {items.length} of {limit} saved searches on your plan.
      </p>
    </div>
  );
}
