import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PasswordForm, PrivacyControls } from "@/components/app/SettingsClient";
import { Badge, Card, SectionLabel } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await getViewer();
  let ackAt: string | null = null;
  if (!viewer.demo) {
    const db = await createSupabaseServer();
    const { data } = (await db?.from("profiles").select("permissible_use_ack_at").eq("id", viewer.userId!).maybeSingle()) ?? { data: null };
    ackAt = (data?.permissible_use_ack_at as string | null) ?? null;
  }
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Account</SectionLabel>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
      </div>
      <Card className="space-y-3 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-subtle">Email</div>
            <div className="mt-0.5 truncate text-sm">{viewer.demo ? "Demo workspace (no account)" : viewer.email}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-subtle">Plan</div>
            <div className="mt-0.5 text-sm">
              <Badge tone="accent">{getPlan(viewer.plan).name}</Badge>{" "}
              <Link href="/app/billing" className="ml-1 text-xs text-accent hover:underline">
                Billing
              </Link>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-subtle">Permissible use</div>
            <div className="mt-0.5 text-sm">
              {viewer.demo ? (
                "Shown on entry to the demo"
              ) : ackAt ? (
                `Acknowledged ${formatDate(ackAt)}`
              ) : (
                <Link href="/onboarding" className="text-accent hover:underline">
                  Review and acknowledge
                </Link>
              )}
            </div>
          </div>
        </div>
      </Card>
      {!viewer.demo ? (
        <Card className="p-5">
          <PasswordForm />
        </Card>
      ) : null}
      <Card className="p-5">
        <PrivacyControls demo={viewer.demo} />
      </Card>
    </div>
  );
}
