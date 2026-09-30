import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { getRepo } from "@/lib/data/repo";
import { ProjectDetail } from "@/components/app/ProjectDetail";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  const data = await repo?.getProject(id).catch(() => null);
  if (!data) notFound();
  const plan = getPlan(viewer.plan);
  return <ProjectDetail project={data.project} items={data.items} canShare={plan.features.collaboration} seats={plan.limits.seats} realAccounts={!viewer.demo} />;
}
