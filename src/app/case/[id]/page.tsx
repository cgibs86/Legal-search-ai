import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CaseViewer } from "@/components/case/CaseViewer";
import { ToastProvider } from "@/components/ui/overlay";

export const metadata: Metadata = { title: "Court decision", robots: { index: false, follow: false } };

export default async function CasePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const viewer = await getViewer();
  return (
    <ToastProvider>
      <SiteHeader />
      <CaseViewer id={id} features={getPlan(viewer.plan).features} signedIn={Boolean(viewer.userId)} />
    </ToastProvider>
  );
}
