"use client";

import { useState } from "react";
import { Check, ChevronDown, Fingerprint, GitMerge, Lock, RotateCcw, Split, X } from "lucide-react";
import type { IdentityCluster, IdentityResolution } from "@/lib/domain/identity";
import type { SearchHit } from "@/lib/domain/types";
import { Badge, Button, ButtonLink, Notice, Select } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { useToast } from "@/components/ui/overlay";
import { cn, formatDate } from "@/lib/utils";
import Link from "next/link";

const CONF: Record<IdentityCluster["confidence"], { label: string; tone: "emerald" | "accent" | "amber" | "neutral" }> = {
  strong: { label: "Strong match", tone: "emerald" },
  possible: { label: "Possible match", tone: "accent" },
  weak: { label: "Weak match", tone: "amber" },
  unresolved: { label: "Unresolved", tone: "neutral" },
};

export function IdentityLocked({ clusterCount, signedIn }: { clusterCount: number; signedIn: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-elev p-6 text-center shadow-card">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-soft text-violet">
        <Fingerprint className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-lg font-semibold">Identity Resolution</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
        These results form <span className="font-semibold text-fg">{clusterCount}</span> possible {clusterCount === 1 ? "identity" : "identities"}, grouped by shared counsel, co-parties, courts and related dockets — with the evidence for every grouping.
      </p>
      <div className="mt-4 flex justify-center">
        <ButtonLink href={signedIn ? "/pricing" : "/signup"} variant="primary">
          <Lock className="h-4 w-4" /> Available on Research Pro
        </ButtonLink>
      </div>
    </div>
  );
}

export function IdentityPanel({ resolution, hits, onChanged, canEdit }: { resolution: IdentityResolution; hits: SearchHit[]; onChanged: () => void; canEdit: boolean }) {
  const byId = new Map(hits.map((h) => [h.id, h]));
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function correct(recordKey: string, action: "confirm" | "reject" | "move" | "split" | "merge", target?: string, source?: string) {
    setBusy(true);
    try {
      await api("/api/identity", { method: "POST", json: { entityKey: resolution.entityKey, recordKey, action, targetClusterId: target ?? null, sourceClusterId: source ?? null } });
      toast(action === "reject" ? "Record removed from this identity" : action === "confirm" ? "Match confirmed for your workspace" : "Groupings updated", "success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await api(`/api/identity?entityKey=${encodeURIComponent(resolution.entityKey)}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Notice tone="neutral" icon={<Fingerprint className="h-4 w-4 text-violet" />} title="Groupings are evidence, not proof" action={resolution.clusters.some((c) => c.userAdjusted) ? <Button size="xs" variant="ghost" onClick={reset} disabled={busy}><RotateCcw className="h-3 w-3" /> Reset my corrections</Button> : null}>
        {resolution.disclaimer}
      </Notice>
      {resolution.clusters.map((c, i) => (
        <ClusterCard key={c.id} cluster={c} index={i} byId={byId} others={resolution.clusters.filter((o) => o.id !== c.id)} canEdit={canEdit} busy={busy} onCorrect={correct} />
      ))}
      {resolution.unresolvedHitIds.length ? (
        <div className="rounded-2xl border border-dashed border-line-strong p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Badge tone="neutral">Unresolved</Badge> {resolution.unresolvedHitIds.length} mention-only record{resolution.unresolvedHitIds.length === 1 ? "" : "s"}
          </div>
          <p className="mt-1 text-xs text-muted">These records mention the name in document text but carry no party, counsel or caption evidence to group them with an identity.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {resolution.unresolvedHitIds.slice(0, 8).map((id) => (
              <li key={id} className="truncate text-muted">
                {byId.get(id)?.record.caseName ?? id}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {resolution.rejectedHitIds.length ? <div className="text-xs text-subtle">{resolution.rejectedHitIds.length} record(s) you rejected are hidden from identities.</div> : null}
    </div>
  );
}

function ClusterCard({
  cluster,
  index,
  byId,
  others,
  canEdit,
  busy,
  onCorrect,
}: {
  cluster: IdentityCluster;
  index: number;
  byId: Map<string, SearchHit>;
  others: IdentityCluster[];
  canEdit: boolean;
  busy: boolean;
  onCorrect: (recordKey: string, action: "confirm" | "reject" | "move" | "split" | "merge", target?: string, source?: string) => void;
}) {
  const [why, setWhy] = useState(index === 0);
  const conf = CONF[cluster.confidence];
  return (
    <section className="rounded-2xl border border-line bg-elev p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={conf.tone}>{conf.label}</Badge>
            {cluster.userAdjusted ? <Badge tone="violet">Adjusted by you</Badge> : null}
            <span className="text-xs text-subtle">{cluster.memberHitIds.length} record{cluster.memberHitIds.length === 1 ? "" : "s"}</span>
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug">{cluster.label}</h3>
          <p className="mt-0.5 text-xs text-muted">{cluster.confidenceExplanation}</p>
        </div>
        {canEdit && others.length ? (
          <Select
            className="h-8 w-auto text-xs"
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && onCorrect(cluster.memberHitIds[0], "merge", e.target.value, cluster.memberHitIds[0])}
            aria-label="Merge into another identity"
          >
            <option value="">Merge into…</option>
            {others.map((o) => (
              <option key={o.id} value={o.memberHitIds[0]}>
                {o.label.slice(0, 60)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      <button onClick={() => setWhy((w) => !w)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent" aria-expanded={why}>
        Why these records were grouped <ChevronDown className={cn("h-3.5 w-3.5 transition", why && "rotate-180")} />
      </button>
      {why ? (
        <div className="mt-2 rounded-xl bg-elev-2 p-3 text-sm">
          <ul className="space-y-1">
            {cluster.groupingReasons.map((r) => (
              <li key={r} className="flex gap-2 text-muted">
                <GitMerge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet" /> {r}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
            <span>Name forms: {cluster.nameForms.join(" · ")}</span>
            <span>Courts: {cluster.courts.join(", ")}</span>
            {cluster.states.length ? <span>States: {cluster.states.join(", ")}</span> : null}
            <span>
              {cluster.dateRange.from ? formatDate(cluster.dateRange.from, { year: "numeric", month: "short" }) : "?"} – {cluster.dateRange.to ? formatDate(cluster.dateRange.to, { year: "numeric", month: "short" }) : "?"}
            </span>
          </div>
        </div>
      ) : null}

      <ul className="mt-3 divide-y divide-line">
        {cluster.memberHitIds.map((id) => {
          const h = byId.get(id);
          if (!h) return null;
          const docketId = h.record.kinds.includes("docket") ? h.record.providerDocketId : null;
          return (
            <li key={id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {docketId ? (
                    <Link className="hover:text-accent" href={`/docket/${docketId}`}>
                      {h.record.caseName}
                    </Link>
                  ) : (
                    h.record.caseName
                  )}
                </div>
                <div className="truncate text-xs text-subtle">
                  {h.record.court.citation ?? h.record.court.name} · listed as “{h.match.matchedText}”{h.match.partyRole ? ` · ${h.match.partyRole}` : ""}
                </div>
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <button disabled={busy} onClick={() => onCorrect(id, "confirm")} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald hover:bg-emerald-soft" title="Confirm match" aria-label="Confirm match">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button disabled={busy} onClick={() => onCorrect(id, "reject")} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose hover:bg-rose-soft" title="Reject match" aria-label="Reject match">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {cluster.memberHitIds.length > 1 ? (
                    <button disabled={busy} onClick={() => onCorrect(id, "split")} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-elev-2" title="Create separate person" aria-label="Create separate person">
                      <Split className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {others.length ? (
                    <Select className="h-7 w-28 text-[11px]" value="" disabled={busy} onChange={(e) => e.target.value && onCorrect(id, "move", e.target.value)} aria-label="Move record to another identity">
                      <option value="">Move to…</option>
                      {others.map((o) => (
                        <option key={o.id} value={o.memberHitIds[0]}>
                          {o.label.slice(0, 50)}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
