import type { Metadata } from "next";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { getRepo } from "@/lib/data/repo";
import { SavedSearches } from "@/components/app/SavedSearches";
import { SectionLabel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Saved searches" };

export default async function SavedPage() {
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  const searches = (await repo?.listSavedSearches()) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Research</SectionLabel>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Saved searches</h1>
      </div>
      <SavedSearches initial={searches} limit={getPlan(viewer.plan).limits.savedSearches} />
    </div>
  );
}
