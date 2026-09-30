"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, FileDown, NotebookPen, Pencil, Trash2, UserPlus, Users, X } from "lucide-react";
import type { Project, ProjectItem, ProjectItemKind } from "@/lib/data/types";
import type { Member } from "@/lib/data/members";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, ButtonLink, EmptyState, Input, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { describeItem, ITEM_KIND_LABEL, ITEM_KIND_ORDER } from "@/lib/ui/projectItems";
import { cn, formatDate, relativeTime } from "@/lib/utils";

export function ProjectDetail({ project, items: initial, canShare, seats, realAccounts }: { project: Project; items: ProjectItem[]; canShare: boolean; seats: number; realAccounts: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<ProjectItemKind | "all">("all");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = project.role !== "viewer";

  const counts = useMemo(() => {
    const m = new Map<ProjectItemKind, number>();
    for (const i of items) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
    return m;
  }, [items]);
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      const { item } = await api<{ item: ProjectItem }>(`/api/projects/${project.id}/items`, { method: "POST", json: { kind: "note", title: note.trim().split("\n")[0].slice(0, 120), note: note.trim(), ref: {} } });
      setItems((xs) => [item, ...xs]);
      setNote("");
    } catch (err) {
      toast((err as ApiError).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(itemId: string) {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== itemId));
    try {
      await api(`/api/projects/${project.id}/items?itemId=${itemId}`, { method: "DELETE" });
    } catch (err) {
      setItems(prev);
      toast((err as ApiError).message, "error");
    }
  }

  async function saveNote(itemId: string, text: string) {
    try {
      await api(`/api/projects/${project.id}/items`, { method: "PATCH", json: { itemId, note: text || null } });
      setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, note: text || null } : x)));
      toast("Note saved", "success");
    } catch (err) {
      toast((err as ApiError).message, "error");
    }
  }

  async function deleteProject() {
    if (!confirm(`Delete “${project.name}” and its ${items.length} saved items? This can't be undone.`)) return;
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      router.push("/app/projects");
      router.refresh();
    } catch (err) {
      toast((err as ApiError).message, "error");
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/app/projects" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1>
          {project.description ? <p className="mt-1 max-w-2xl text-muted">{project.description}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-subtle">
            <span>{items.length} items</span>
            <span>Updated {relativeTime(project.updatedAt)}</span>
            {project.role !== "owner" ? <Badge>{project.role}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink size="sm" variant="secondary" href={`/app/projects/${project.id}/report`}>
            <FileDown className="h-4 w-4" /> Report / PDF
          </ButtonLink>
          {project.role === "owner" ? (
            <Button size="sm" variant="ghost" onClick={deleteProject} className="text-rose">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={items.length} />
            {ITEM_KIND_ORDER.filter((k) => counts.get(k)).map((k) => (
              <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)} label={ITEM_KIND_LABEL[k]} count={counts.get(k)!} />
            ))}
          </div>
          {shown.length ? (
            shown.map((i) => <ItemCard key={i.id} item={i} editable={editable} onRemove={() => remove(i.id)} onSaveNote={(t) => saveNote(i.id, t)} />)
          ) : (
            <EmptyState icon={<NotebookPen className="h-6 w-6" />} title="Nothing saved yet">
              Use “Save to project” on any result, docket, filing, AI brief or entity profile.
            </EmptyState>
          )}
        </div>

        <div className="space-y-4">
          {editable ? (
            <form onSubmit={addNote} className="space-y-2 rounded-2xl border border-line bg-elev p-4 shadow-card">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <NotebookPen className="h-4 w-4 text-subtle" /> Add a note
              </div>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={10_000} placeholder="Findings, open questions, next steps…" />
              <Button type="submit" size="sm" loading={busy}>
                Add note
              </Button>
            </form>
          ) : null}
          <Members projectId={project.id} isOwner={project.role === "owner"} canShare={canShare} seats={seats} realAccounts={realAccounts} />
        </div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition", active ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}>
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function ItemCard({ item, editable, onRemove, onSaveNote }: { item: ProjectItem; editable: boolean; onRemove: () => void; onSaveNote: (t: string) => void }) {
  const d = describeItem(item);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.note ?? "");
  useEffect(() => setText(item.note ?? ""), [item.note]);
  return (
    <div className="rounded-2xl border border-line bg-elev p-4 shadow-card">
      <div className="flex items-start gap-2">
        <Badge tone={item.kind === "ai_summary" ? "violet" : item.kind === "note" ? "neutral" : item.kind === "entity" ? "accent" : "cyan"}>{ITEM_KIND_LABEL[item.kind]}</Badge>
        <div className="min-w-0 flex-1">
          {d.href ? (
            <Link href={d.href} className="font-medium leading-snug hover:text-accent">
              {item.title}
            </Link>
          ) : (
            <div className="font-medium leading-snug">{item.title}</div>
          )}
          {d.meta.length ? <div className="mt-0.5 text-xs text-muted">{d.meta.join(" · ")}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {d.source ? (
            <a href={d.source} target="_blank" rel="noreferrer" className="rounded p-1.5 text-subtle hover:text-fg" aria-label="Open source">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {editable ? (
            <>
              <button onClick={() => setEditing((v) => !v)} className="rounded p-1.5 text-subtle hover:text-fg" aria-label="Edit note">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={onRemove} className="rounded p-1.5 text-subtle hover:text-rose" aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>
      </div>
      {typeof item.ref.description === "string" ? <p className="mt-2 line-clamp-3 text-sm text-muted">{item.ref.description}</p> : null}
      {d.brief ? (
        <details className="mt-2 rounded-xl bg-elev-2 p-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted">Brief · {d.brief.sections.filter((s) => !s.insufficient).length} sections · generated {formatDate(d.brief.generatedAt)}</summary>
          <div className="mt-2 space-y-2">
            {d.brief.sections
              .filter((s) => !s.insufficient)
              .map((s) => (
                <div key={s.key}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{s.title}</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {s.statements.map((st, i) => (
                      <li key={i}>
                        {st.text} <span className="font-mono text-[10px] text-accent">{st.sources.map((x) => x.id).join(" ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </details>
      ) : null}
      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={10_000} placeholder="Add a note" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { onSaveNote(text); setEditing(false); }}>
              Save note
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : item.note && item.kind !== "note" ? (
        <p className="mt-2 whitespace-pre-line rounded-lg border-l-2 border-accent/50 pl-3 text-sm text-fg/90">{item.note}</p>
      ) : item.kind === "note" && item.note ? (
        <p className="mt-2 whitespace-pre-line text-sm text-fg/90">{item.note}</p>
      ) : null}
      <div className="mt-2 text-[11px] text-subtle">Saved {relativeTime(item.createdAt)}</div>
    </div>
  );
}

function Members({ projectId, isOwner, canShare, seats, realAccounts }: { projectId: string; isOwner: boolean; canShare: boolean; seats: number; realAccounts: boolean }) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!realAccounts) return;
    api<{ members: Member[] }>(`/api/projects/${projectId}/members`)
      .then((d) => setMembers(d.members))
      .catch(() => setMembers([]));
  }, [projectId, realAccounts]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { member } = await api<{ member: Member }>(`/api/projects/${projectId}/members`, { method: "POST", json: { email, role } });
      setMembers((m) => [...(m ?? []), member]);
      setEmail("");
      toast("Added to project", "success");
    } catch (err) {
      toast((err as ApiError).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    try {
      await api(`/api/projects/${projectId}/members`, { method: "DELETE", json: { userId } });
      setMembers((m) => (m ?? []).filter((x) => x.userId !== userId));
    } catch (err) {
      toast((err as ApiError).message, "error");
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-elev p-4 shadow-card">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4 text-subtle" /> People
      </div>
      {!realAccounts ? (
        <p className="text-sm text-muted">The demo workspace is single-user. Shared workspaces (Intelligence) work with real accounts.</p>
      ) : members === null ? (
        <p className="text-sm text-subtle">Loading…</p>
      ) : (
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{m.email ?? "Account"}</span>
              <Badge>{m.role}</Badge>
              {isOwner && m.role !== "owner" ? (
                <button onClick={() => removeMember(m.userId)} className="rounded p-1 text-subtle hover:text-rose" aria-label={`Remove ${m.email ?? "member"}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {realAccounts && isOwner ? (
        canShare ? (
          <form onSubmit={add} className="space-y-2 border-t border-line pt-3">
            <div className="flex gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@firm.com" required className="h-9" />
              <Select value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")} className="w-28">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </Select>
            </div>
            <Button type="submit" size="sm" loading={busy}>
              <UserPlus className="h-4 w-4" /> Add person
            </Button>
            <p className="text-[11px] text-subtle">Up to {seats} people per workspace, including you. They need an account first.</p>
          </form>
        ) : (
          <p className="border-t border-line pt-3 text-xs text-muted">
            Shared workspaces are included in{" "}
            <Link href="/app/billing" className="text-accent hover:underline">
              Intelligence
            </Link>
            .
          </p>
        )
      ) : null}
    </div>
  );
}
