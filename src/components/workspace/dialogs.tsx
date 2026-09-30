"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, FolderPlus, Lock } from "lucide-react";
import { Sheet, useToast } from "@/components/ui/overlay";
import { Button, ButtonLink, Input, Label, Notice, Select, Toggle } from "@/components/ui/primitives";
import { api, ApiError, track } from "@/lib/client/api";
import type { Project, ProjectItemKind, WatchKind } from "@/lib/data/types";
import { minimumPlanFor, type FeatureKey } from "@/lib/config/plans";

export interface SaveTarget {
  kind: ProjectItemKind;
  title: string;
  ref: Record<string, unknown>;
  note?: string;
}

export function SaveToProjectDialog({ target, onClose, signedIn }: { target: SaveTarget | null; onClose: () => void; signedIn: boolean }) {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target || !signedIn) return;
    setError(null);
    setNote(target.note ?? "");
    api<{ projects: Project[] }>("/api/projects")
      .then((d) => {
        setProjects(d.projects);
        setProjectId(d.projects[0]?.id ?? "");
      })
      .catch((e) => setError(e as ApiError));
  }, [target, signedIn]);

  async function save() {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      let id = projectId;
      if (!id || id === "__new") {
        const created = await api<{ project: Project }>("/api/projects", { method: "POST", json: { name: newName.trim() || `Research: ${target.title.slice(0, 60)}` } });
        id = created.project.id;
      }
      await api(`/api/projects/${id}/items`, { method: "POST", json: { kind: target.kind, title: target.title, ref: target.ref, note: note || null } });
      toast(
        <span>
          Saved to project. <Link className="font-medium text-accent" href={`/app/projects/${id}`}>Open</Link>
        </span>,
        "success",
      );
      onClose();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={Boolean(target)} onClose={onClose} title="Save to research project">
      {!signedIn ? (
        <SignInPrompt what="save research" />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-elev-2 p-3 text-sm">
            <div className="text-[11px] uppercase tracking-wider text-subtle">{target?.kind.replace("_", " ")}</div>
            <div className="mt-0.5 font-medium">{target?.title}</div>
          </div>
          {error ? <GateNotice error={error} /> : null}
          <div className="space-y-1.5">
            <Label htmlFor="proj">Project</Label>
            <Select id="proj" value={projectId || "__new"} onChange={(e) => setProjectId(e.target.value)}>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.itemCount})
                </option>
              ))}
              <option value="__new">+ New project…</option>
            </Select>
          </div>
          {!projectId || projectId === "__new" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pname">New project name</Label>
              <Input id="pname" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Acme Due Diligence" maxLength={120} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="pnote">Note (optional)</Label>
            <Input id="pnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this matters" maxLength={500} />
          </div>
          <Button onClick={save} loading={saving} className="w-full justify-center">
            <FolderPlus className="h-4 w-4" /> Save
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export interface WatchTarget {
  kind: WatchKind;
  label: string;
  query: { query?: string; entityType?: string; docketId?: string; recordKey?: string };
}

export function WatchDialog({ target, onClose, signedIn }: { target: WatchTarget | null; onClose: () => void; signedIn: boolean }) {
  const toast = useToast();
  const [frequency, setFrequency] = useState<"immediate" | "daily" | "weekly">("daily");
  const [email, setEmail] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (target) {
      setLabel(target.label);
      setError(null);
    }
  }, [target]);

  async function create() {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      await api("/api/watchlists", { method: "POST", json: { kind: target.kind, label, query: target.query, frequency, channels: { email, in_app: inApp } } });
      track("first_alert_created");
      toast(
        <span>
          Case Radar is watching “{label}”. <Link className="font-medium text-accent" href="/app/radar">Manage</Link>
        </span>,
        "success",
      );
      onClose();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  const docket = target?.kind === "docket";
  return (
    <Sheet open={Boolean(target)} onClose={onClose} title="Monitor with Case Radar">
      {!signedIn ? (
        <SignInPrompt what="create alerts" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {docket
              ? "We'll check this docket and show only what changed since the last check — new filings, orders, hearings, deadlines and status changes."
              : "We'll alert you when this name appears in a newly indexed case or filing. Name matches are not proof of identity."}
          </p>
          {error ? <GateNotice error={error} /> : null}
          <div className="space-y-1.5">
            <Label htmlFor="wlabel">Alert name</Label>
            <Input id="wlabel" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["immediate", "daily", "weekly"] as const).map((f) => (
                <button key={f} onClick={() => setFrequency(f)} className={`h-10 rounded-xl border text-sm font-medium ${frequency === f ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}>
                  {f === "immediate" ? "As found" : f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-subtle">“As found” checks each scheduled run (hourly; every 20 minutes on Intelligence where supported). Daily and weekly send one digest.</p>
          </div>
          <div className="space-y-2 rounded-xl bg-elev-2 p-3">
            <div className="flex items-center justify-between text-sm">
              <span>Email</span>
              <Toggle checked={email} onChange={setEmail} label="Email alerts" />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>In-app</span>
              <Toggle checked={inApp} onChange={setInApp} label="In-app alerts" />
            </div>
          </div>
          <Button onClick={create} loading={saving} className="w-full justify-center">
            <Bell className="h-4 w-4" /> Start monitoring
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function SignInPrompt({ what }: { what: string }) {
  return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-muted">Create an account to {what}.</p>
      <ButtonLink href="/signup" className="w-full justify-center">
        Create account <ArrowRight className="h-4 w-4" />
      </ButtonLink>
    </div>
  );
}

export function GateNotice({ error }: { error: ApiError }) {
  if (error.needsUpgrade) {
    return (
      <Notice tone="accent" icon={<Lock className="h-4 w-4 text-accent" />} title={error.message} action={<ButtonLink href="/pricing" size="sm">See plans</ButtonLink>}>
        {error.extra.limit != null ? `Used ${error.extra.used ?? error.extra.limit} of ${error.extra.limit}.` : null}
      </Notice>
    );
  }
  return <Notice tone="rose">{error.message}</Notice>;
}

export function UpgradeDialog({ feature, onClose, signedIn }: { feature: FeatureKey | null; onClose: () => void; signedIn: boolean }) {
  const plan = feature ? minimumPlanFor(feature) : null;
  return (
    <Sheet open={Boolean(feature)} onClose={onClose} title={plan ? `Included in ${plan.name}` : ""}>
      {plan ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">{plan.tagline}</p>
          <ul className="space-y-1.5 text-sm">
            {plan.highlights.map((h) => (
              <li key={h} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" /> {h}
              </li>
            ))}
          </ul>
          <ButtonLink href={signedIn ? `/pricing?plan=${plan.id}` : `/signup?plan=${plan.id}`} className="w-full justify-center">
            {signedIn ? `Upgrade to ${plan.name} — $${plan.priceMonthlyUsd}/mo` : "Create account"} <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      ) : null}
    </Sheet>
  );
}
