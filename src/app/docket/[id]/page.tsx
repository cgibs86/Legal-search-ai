import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DocketViewer } from "@/components/docket/DocketViewer";
import { ToastProvider } from "@/components/ui/overlay";

export const metadata: Metadata = { title: "Docket", robots: { index: false, follow: false } };

export default async function DocketPage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const viewer = await getViewer();
  return (
    <ToastProvider>
      <SiteHeader />
      <DocketViewer id={id} features={getPlan(viewer.plan).features} signedIn={Boolean(viewer.userId)} showDiff={sp.diff === "1"} />
    </ToastProvider>
  );
}
