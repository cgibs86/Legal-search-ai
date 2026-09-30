import "server-only";
import { resolveDataMode } from "@/lib/config/env";
import { CourtListenerProvider } from "./courtlistener/adapter";
import { clFetch } from "./courtlistener/client";
import { demoFetch, DEMO_CAPTURED_AT } from "./demo/transport";
import { PacerProvider } from "./pacer/adapter";
import { TrellisProvider } from "./trellis/adapter";
import type { CourtDataProvider } from "./types";

let primary: CourtDataProvider | null = null;
let primaryMode: "live" | "demo" | null = null;
const pacer = new PacerProvider();
const trellis = new TrellisProvider();

/** The primary provider: CourtListener live, or the labeled demo snapshot. */
export function getPrimaryProvider(): CourtDataProvider {
  const mode = resolveDataMode();
  if (!primary || primaryMode !== mode) {
    primary = mode === "live" ? new CourtListenerProvider("live", clFetch) : new CourtListenerProvider("demo", demoFetch, DEMO_CAPTURED_AT);
    primaryMode = mode;
  }
  return primary;
}

export function getPacerProvider(): PacerProvider {
  return pacer;
}

export function getStateTrialProvider(): TrellisProvider {
  return trellis;
}

export function allProviders(): CourtDataProvider[] {
  return [getPrimaryProvider(), pacer, trellis];
}
