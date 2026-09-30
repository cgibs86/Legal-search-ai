import { getViewer } from "@/lib/auth/session";
import { features, getEnv, resolveDataMode } from "@/lib/config/env";
import { json } from "@/lib/api/http";
import { allProviders } from "@/lib/providers/registry";
import { budgetUsed } from "@/lib/usage/providerBudget";
import { CL_BUDGET_KEY } from "@/lib/providers/courtlistener/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public liveness plus provider configuration; quota detail for admins only. */
export async function GET() {
  const viewer = await getViewer();
  const base = {
    ok: true,
    dataMode: resolveDataMode(),
    providers: allProviders().map((p) => p.health()),
    services: { auth: features.supabase(), billing: features.stripe(), ai: features.ai(), email: features.email() },
  };
  if (!viewer.isAdmin) return json(base);
  return json({ ...base, courtlistenerBudget: { used24h: await budgetUsed(CL_BUDGET_KEY), limit: getEnv().COURTLISTENER_DAILY_REQUEST_BUDGET } });
}
