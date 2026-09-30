"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, FolderPlus, Users } from "lucide-react";
import type { Project } from "@/lib/data/types";
import { api, ApiError, track } from "@/lib/client/api";
import { Badge, Button, EmptyState, Input, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { GateNotice } from "@/components/workspace/dialogs";
import { relativeTime } from "@/lib/utils";

export function ProjectsClient({ projects, canCreate, limit }: { projects: Project[]; canCreate: boolean; limit: number }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<ApiError | null>(null);
  const owned = projects.filter((p) => p.role === "owner").length;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setGate(null);
    try {
      const { project } = await api<{ project: Project }>("/api/projects", { method: "POST", json: { name, description: description || null } });
      if (!projects.length) track("first_project_created");
      router.push(`/app/projects/${project.id}`);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.needsUpgrade) setGate(e2);
      else toast(e2.message, "error");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {projects.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/app/projects/${p.id}`} className="group rounded-2xl border border-line bg-elev p-4 shadow-card transition hover:border-line-strong">
                <div className="flex items-start gap-2">
                  <FolderOpen className="mt-0.5 h-4 w-4 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium group-hover:text-accent">{p.name}</div>
                    {p.description ? <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.description}</p> : null}
                  </div>
                  {p.role !== "owner" ? (
                    <Badge title={`You are a ${p.role}`}>
                      <Users className="h-3 w-3" /> Shared
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-3 text-xs text-subtle">
                  <span>{p.itemCount} items</span>
                  <span>Updated {relativeTime(p.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="No projects yet">
            Projects collect the entities, dockets, filings, AI briefs, timeline items and notes for one matter or investigation.
          </EmptyState>
        )}
      </div>
      <div>
        <form onSubmit={create} className="space-y-3 rounded-2xl border border-line bg-elev p-4 shadow-card">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderPlus className="h-4 w-4 text-subtle" /> New project
          </div>
          {canCreate ? (
            <>
              <div>
                <Label htmlFor="pname">Name</Label>
                <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Acme Corp — vendor due diligence" required />
              </div>
              <div>
                <Label htmlFor="pdesc">Description (optional)</Label>
                <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} />
              </div>
              <Button type="submit" loading={busy} className="w-full justify-center">
                Create project
              </Button>
              <p className="text-[11px] text-subtle">
                {owned} of {limit} projects on your plan.
              </p>
              {gate ? <GateNotice error={gate} /> : null}
            </>
          ) : (
            <div className="space-y-2 text-sm text-muted">
              <p>Research workspaces are included in Research Pro and Intelligence.</p>
              <Link href="/app/billing" className="text-accent hover:underline">
                Compare plans
              </Link>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
