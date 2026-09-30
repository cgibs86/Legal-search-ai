import type { Metadata } from "next";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { getRepo } from "@/lib/data/repo";
import { ProjectsClient } from "@/components/app/ProjectsClient";
import { SectionLabel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const viewer = await getViewer();
  const plan = getPlan(viewer.plan);
  const repo = await getRepo(viewer);
  const projects = (await repo?.listProjects()) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Research workspaces</SectionLabel>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1>
      </div>
      <ProjectsClient projects={projects} canCreate={plan.features.researchWorkspaces} limit={plan.limits.projects} />
    </div>
  );
}
