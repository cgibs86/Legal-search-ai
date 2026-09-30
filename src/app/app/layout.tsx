import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { features } from "@/lib/config/env";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AppNav } from "@/components/app/AppNav";
import { ToastProvider } from "@/components/ui/overlay";

export const metadata: Metadata = { title: { default: "Workspace", template: "%s · Legal Search AI" }, robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer.userId) redirect(features.supabase() ? "/login?next=/app" : "/demo");
  return (
    <ToastProvider>
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
        <AppNav />
        {children}
      </div>
    </ToastProvider>
  );
}
