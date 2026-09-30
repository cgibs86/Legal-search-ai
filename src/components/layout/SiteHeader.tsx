import { getViewer } from "@/lib/auth/session";
import { getRepo } from "@/lib/data/repo";
import { features } from "@/lib/config/env";
import { getPlan } from "@/lib/config/plans";
import { HeaderClient } from "./HeaderClient";

export async function SiteHeader({ variant = "default" }: { variant?: "default" | "transparent" }) {
  const viewer = await getViewer();
  let unread = 0;
  if (viewer.userId) {
    try {
      const repo = await getRepo(viewer);
      unread = (await repo?.unreadAlertCount()) ?? 0;
    } catch {
      unread = 0;
    }
  }
  return (
    <HeaderClient
      variant={variant}
      viewer={{ kind: viewer.kind, email: viewer.email, planName: getPlan(viewer.plan).name, plan: viewer.plan, isAdmin: viewer.isAdmin, demo: viewer.demo }}
      unread={unread}
      authEnabled={features.supabase()}
    />
  );
}
