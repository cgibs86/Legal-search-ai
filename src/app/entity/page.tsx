import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { EntityTypeSchema } from "@/lib/api/schemas";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { EntityProfileView } from "@/components/entity/EntityProfileView";
import { ToastProvider } from "@/components/ui/overlay";

export const metadata: Metadata = { title: "Entity profile", robots: { index: false, follow: false } };

export default async function EntityPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim().slice(0, 160);
  if (!q) redirect("/search");
  const type = EntityTypeSchema.safeParse(sp.type);
  const viewer = await getViewer();
  return (
    <ToastProvider>
      <SiteHeader />
      <EntityProfileView key={`${q}|${type.success ? type.data : ""}`} query={q} entityType={type.success ? type.data : null} features={getPlan(viewer.plan).features} signedIn={Boolean(viewer.userId)} />
    </ToastProvider>
  );
}
