import type { Metadata } from "next";
import { Suspense } from "react";
import { getViewer } from "@/lib/auth/session";
import { features as envFeatures } from "@/lib/config/env";
import { getPlan } from "@/lib/config/plans";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SearchExperience } from "@/components/search/SearchExperience";
import { ToastProvider } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: false },
};

export default async function SearchPage() {
  const viewer = await getViewer();
  const plan = getPlan(viewer.plan);
  return (
    <ToastProvider>
      <SiteHeader />
      <Suspense fallback={<div className="mx-auto max-w-3xl space-y-3 px-4 py-16"><Skeleton className="h-16 w-full rounded-2xl" /></div>}>
        <SearchExperience features={plan.features} signedIn={Boolean(viewer.userId)} authEnabled={envFeatures.supabase() || viewer.demo} planName={plan.name} />
      </Suspense>
    </ToastProvider>
  );
}
