import "server-only";
import { features } from "@/lib/config/env";
import {
  notConfigured,
  type CourtDataProvider,
  type ProviderCoverage,
  type ProviderHealth,
  type ProviderResult,
} from "@/lib/providers/types";

/**
 * Placeholder adapter for a licensed state trial-court data provider (Trellis or similar).
 * No integration is faked: every call returns `not_configured` until a real client is
 * implemented against the provider's licensed API and TRELLIS_API_KEY is set.
 * The Coverage Ledger shows this source as "Not configured".
 */
export class TrellisProvider implements CourtDataProvider {
  readonly id = "trellis" as const;
  readonly label = "State trial courts (licensed provider — not connected)";
  readonly capabilities = {
    searchEntities: false,
    searchDockets: false,
    searchOpinions: false,
    searchDocuments: false,
    getDocket: false,
    getCase: false,
    getParties: false,
    getAttorneys: false,
    getDocument: false,
    createMonitor: false,
    paid: true,
  };

  health(): ProviderHealth {
    const configured = features.trellis();
    return {
      provider: this.id,
      configured,
      enabled: false,
      live: false,
      reason: configured
        ? "API key present, but the adapter is not implemented yet. See README > Adding a state-court provider."
        : "No licensed state trial-court provider is connected.",
    };
  }

  getCoverage(): ProviderCoverage {
    return {
      provider: this.id,
      label: this.label,
      recordTypes: ["State trial-court dockets"],
      jurisdictions: "Not searched",
      dateCoverage: null,
      notes: ["State trial-court dockets (evictions, most criminal, family and small-claims matters) require a licensed provider or state-by-state integrations."],
    };
  }

  private nc<T>(): Promise<ProviderResult<T>> {
    return Promise.resolve(notConfigured<T>(this.id, this.health().reason ?? "not connected"));
  }

  searchEntities = () => this.nc<never>();
  searchDockets = () => this.nc<never>();
  searchOpinions = () => this.nc<never>();
  searchDocuments = () => this.nc<never>();
  getDocket = () => this.nc<never>();
  getDocketEntries = () => this.nc<never>();
  getCase = () => this.nc<never>();
  getParties = () => this.nc<never>();
  getAttorneys = () => this.nc<never>();
  getDocument = () => this.nc<never>();
  createMonitor = () => this.nc<never>();
}
