import type { Metadata } from "next";
import { getViewer } from "@/lib/auth/session";
import { features } from "@/lib/config/env";
import { getPlan } from "@/lib/config/plans";
import { RadarView } from "@/components/app/RadarView";
import { SectionLabel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Case Radar" };

export default async function RadarPage() {
  const viewer = await getViewer();
  const plan = getPlan(viewer.plan);
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Monitoring</SectionLabel>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Case Radar</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">New lawsuits, filings and docket changes for the names and cases you watch. An alert means a matching record appeared — not that it concerns the same person or company.</p>
      </div>
      <RadarView activeLimit={plan.limits.activeAlerts} priority={plan.features.priorityRefresh} emailEnabled={features.email()} demo={viewer.demo} />
    </div>
  );
}
