import "server-only";
import { coverageStats, COURTS_SNAPSHOT_DATE } from "@/lib/courts";
import type { CoverageLedger, CoverageSource, NameVariant, SearchFilters, SourceStatus } from "@/lib/domain/types";
import type { ProviderHealth, SourceResult } from "@/lib/providers/types";
import { describeFilters } from "./filters";
import { pacerFeePerPageUsd } from "@/lib/providers/pacer/policy";

/**
 * COVERAGE LEDGER — what was searched, what was not, and how much to trust the counts.
 * Built from the actual source results of this search, never from marketing copy.
 */

export interface LedgerInput {
  dataMode: "live" | "demo";
  primarySources: SourceResult[];
  pacer: { health: ProviderHealth; result: SourceResult | null; requested: boolean };
  stateTrial: ProviderHealth;
  variants: NameVariant[];
  filters: SearchFilters;
  entityType: string;
  dedupedCount: number;
  now?: Date;
}

const SOURCE_META: Record<string, { recordTypes: string[]; jurisdictions: string; dateCoverage: string }> = {
  dockets: {
    recordTypes: ["Dockets", "Parties", "Attorneys"],
    jurisdictions: "Federal district, bankruptcy and appellate courts",
    dateCoverage: "Varies by case. New district and bankruptcy cases are indexed with basic metadata shortly after filing; full party lists exist only for dockets retrieved from PACER.",
  },
  opinions: {
    recordTypes: ["Opinions / decisions"],
    jurisdictions: "Federal courts; state supreme and appellate courts; some state trial courts",
    dateCoverage: "Back to the 1600s for precedential case law",
  },
  filings: {
    recordTypes: ["Filings (full text)", "Docket entry text"],
    jurisdictions: "Federal courts (documents in the RECAP Archive only)",
    dateCoverage: "Only documents someone has retrieved from PACER",
  },
};

function freshest(result: SourceResult): string | null {
  const ts = result.hits.flatMap((h) => h.record.sources.map((s) => s.indexedAt)).filter(Boolean) as string[];
  return ts.length ? ts.sort().at(-1)! : null;
}

function statusNote(status: SourceStatus, message: string | null): string | null {
  if (message) return message;
  const map: Partial<Record<SourceStatus, string>> = {
    timeout: "The source did not respond in time.",
    quota_exhausted: "Request quota reached; results may be incomplete.",
    failed: "The source returned an error.",
  };
  return map[status] ?? null;
}

export function buildCoverageLedger(i: LedgerInput): CoverageLedger {
  const now = (i.now ?? new Date()).toISOString();
  const providerLabel = i.dataMode === "demo" ? "Demo snapshot" : "CourtListener";
  const sources: CoverageSource[] = i.primarySources.map((s) => {
    const meta = SOURCE_META[s.source] ?? { recordTypes: [], jurisdictions: "", dateCoverage: "" };
    const fresh = freshest(s);
    return {
      id: `${i.dataMode}-${s.source}`,
      provider: i.dataMode === "demo" ? "demo" : "courtlistener",
      label: `${providerLabel} · ${s.label}`,
      recordTypes: meta.recordTypes,
      jurisdictions: meta.jurisdictions,
      status: s.status,
      resultCount: s.totalCount,
      countIsApproximate: s.countIsApproximate,
      dateCoverage: meta.dateCoverage,
      freshness: fresh ? `Newest index update among results: ${fresh.slice(0, 10)}` : s.cached ? "Served from cache" : null,
      note: statusNote(s.status, s.message),
    };
  });

  const pacerStatus: SourceStatus = i.pacer.result ? i.pacer.result.status : !i.pacer.health.configured ? "not_configured" : !i.pacer.health.enabled ? "disabled" : "skipped";
  sources.push({
    id: "pacer-pcl",
    provider: "pacer_pcl",
    label: "PACER Case Locator (direct, paid)",
    recordTypes: ["Federal case & party index"],
    jurisdictions: "All federal courts indexed by PCL",
    status: pacerStatus,
    resultCount: i.pacer.result?.totalCount ?? null,
    countIsApproximate: false,
    dateCoverage: "Per PCL",
    freshness: i.pacer.result ? "Queried live" : null,
    note:
      i.pacer.result?.message ??
      (pacerStatus === "skipped"
        ? `Not searched automatically. Paid at $${pacerFeePerPageUsd().toFixed(2)} per page of up to 54 results; available on request.`
        : i.pacer.health.reason),
  });

  sources.push({
    id: "state-trial",
    provider: i.stateTrial.configured ? "trellis" : "none",
    label: "State trial-court dockets",
    recordTypes: ["State trial dockets"],
    jurisdictions: "State trial courts (all states)",
    status: "unavailable",
    resultCount: null,
    countIsApproximate: false,
    dateCoverage: null,
    freshness: null,
    note: i.stateTrial.reason ?? "No licensed state trial-court provider is connected.",
  });

  const stats = coverageStats();
  const stat = (code: string) => stats.find((s) => s.code === code);
  const searchedDockets = i.primarySources.some((s) => s.source !== "opinions" && (s.status === "searched" || s.status === "partial"));
  const searchedOpinions = i.primarySources.some((s) => s.source === "opinions" && (s.status === "searched" || s.status === "partial"));
  const jurisdictionsSearched: CoverageLedger["jurisdictionsSearched"] = [];
  if (searchedDockets || searchedOpinions) {
    for (const code of ["F", "FD", "FB"]) {
      const s = stat(code);
      if (s) jurisdictionsSearched.push({ label: s.label, courts: s.courts, note: searchedDockets ? "Dockets, filings and decisions" : "Decisions only" });
    }
  }
  if (searchedOpinions) {
    for (const code of ["S", "SA"]) {
      const s = stat(code);
      if (s) jurisdictionsSearched.push({ label: s.label, courts: s.courts, note: "Published and unpublished decisions only (no dockets)" });
    }
    const st = stat("ST");
    if (st) jurisdictionsSearched.push({ label: st.label, courts: st.courtsWithRecords, note: `Only courts with indexed decisions (${st.courtsWithRecords} of ${st.courts}); no dockets` });
  }

  const jurisdictionsUnavailable: CoverageLedger["jurisdictionsUnavailable"] = [
    { label: "State trial-court dockets", reason: "Evictions, most criminal, family, probate and small-claims matters are filed here. No connected source provides these dockets." },
    { label: "Federal dockets never retrieved from PACER", reason: "Only basic metadata (caption, number, dates) is indexed; party lists and documents are missing, so party-name matches can be missed." },
    { label: "Sealed, expunged or restricted records", reason: "Not available from public sources." },
  ];
  if (i.filters.jurisdiction === "state") jurisdictionsUnavailable.unshift({ label: "Federal courts", reason: "Excluded by your jurisdiction filter." });

  const anyApprox = sources.some((s) => s.countIsApproximate);
  const variantsSearched = i.variants;
  const notes: string[] = [];
  if (i.dataMode === "demo") notes.push("DEMO MODE: results come from a small, labeled snapshot of public records captured on 2026-09-30 — not live data.");
  if (i.entityType === "person" || i.entityType === "attorney") notes.push("Court records can contain different people with identical names. A result does not establish identity.");
  notes.push("Filings contain allegations, not proven facts. Records may be incomplete, delayed, amended, sealed or removed.");
  notes.push(`Court coverage statistics from CourtListener's jurisdiction table (${COURTS_SNAPSHOT_DATE}).`);
  for (const s of i.primarySources) if (s.message && s.status === "searched") notes.push(`${s.label}: ${s.message}`);

  return {
    searchedAt: now,
    dataMode: i.dataMode,
    sources,
    jurisdictionsSearched,
    jurisdictionsUnavailable,
    recordTypes: [
      { type: "Federal dockets", searched: searchedDockets, note: "RECAP Archive" },
      { type: "Federal filings (full text)", searched: i.primarySources.some((s) => s.source === "filings" && s.status === "searched"), note: "Documents in RECAP only" },
      { type: "Court opinions", searched: searchedOpinions, note: "Federal and state" },
      { type: "Party & attorney lists", searched: searchedDockets, note: "Where captured" },
      { type: "State trial-court dockets", searched: false, note: "Not available" },
    ],
    counts: {
      exact: !anyApprox,
      note: anyApprox
        ? `Source counts above 2,000 are estimates (±6%). ${i.dedupedCount} unique matters shown after de-duplication.`
        : `Source counts are exact for retrieved pages. ${i.dedupedCount} unique matters shown after de-duplication.`,
    },
    variantsSearched,
    filtersApplied: describeFilters(i.filters),
    notes,
  };
}
