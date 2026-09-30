import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, Bookmark, CheckCircle2, Circle, FolderOpen, Search } from "lucide-react";
import { getViewer } from "@/lib/auth/session";
import { getPlan } from "@/lib/config/plans";
import { getRepo } from "@/lib/data/repo";
import { countUsage, monthStartIso } from "@/lib/usage/events";
import { searchHref } from "@/lib/search/urlParams";
import { SearchBar } from "@/components/search/SearchBar";
import { Badge, ButtonLink, Card, SectionLabel } from "@/components/ui/primitives";
import { cn, formatDate, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

export default async function Dashboard() {
  const viewer = await getViewer();
  const plan = getPlan(viewer.plan);
  const repo = await getRepo(viewer);
  const since = monthStartIso();
  const [projects, watches, alerts, saved, views, briefs, exportsUsed, everViewed] = await Promise.all([
    repo?.listProjects() ?? [],
    repo?.listWatchlists() ?? [],
    repo?.listAlerts({ limit: 6 }) ?? [],
    repo?.listSavedSearches() ?? [],
    countUsage(viewer.userId!, "record_view", since, true),
    countUsage(viewer.userId!, "ai_brief", since, true),
    countUsage(viewer.userId!, "export", since),
    countUsage(viewer.userId!, "record_view", "1970-01-01T00:00:00Z"),
  ]);
  const activeWatches = watches.filter((w) => w.active).length;
  const unread = alerts.filter((a) => !a.readAt).length;

  const meters = [
    { label: "Detailed record views", used: views, limit: plan.limits.detailedViewsPerMonth, period: "this month" },
    { label: "AI Case Briefs", used: briefs, limit: plan.limits.aiBriefsPerMonth, period: "this month" },
    { label: "Exports", used: exportsUsed, limit: plan.limits.exportsPerMonth, period: "this month" },
    { label: "Active alerts", used: activeWatches, limit: plan.limits.activeAlerts, period: "" },
    { label: "Saved searches", used: saved.length, limit: plan.limits.savedSearches, period: "" },
    { label: "Projects", used: projects.filter((p) => p.role === "owner").length, limit: plan.limits.projects, period: "" },
  ];

  const steps = [
    { done: everViewed > 0, label: "Open a full docket or case record", href: "/search" },
    { done: saved.length > 0, label: "Save a search you'll re-run", href: "/search" },
    { done: watches.length > 0, label: "Watch a name or docket with Case Radar", href: "/search" },
    { done: projects.length > 0, label: "Start a research project", href: "/app/projects" },
  ];
  const stepsDone = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel>Workspace</SectionLabel>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Overview</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Badge tone={viewer.plan === "free" ? "neutral" : "accent"}>{plan.name}</Badge>
          {viewer.subscription?.status === "trialing" && viewer.subscription.trialEnd ? <span>Trial ends {formatDate(viewer.subscription.trialEnd)}</span> : null}
          {viewer.subscription?.cancelAtPeriodEnd && viewer.subscription.currentPeriodEnd ? <span>Ends {formatDate(viewer.subscription.currentPeriodEnd)}</span> : null}
          {viewer.plan === "free" ? (
            <ButtonLink size="sm" href="/app/billing">
              Choose a plan
            </ButtonLink>
          ) : null}
        </div>
      </div>

      <Card className="p-4 sm:p-5">
        <SearchBar size="md" />
      </Card>

      {stepsDone < steps.length ? (
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Get set up</div>
            <div className="text-xs text-subtle">
              {stepsDone} of {steps.length} done
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-elev-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
          </div>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-elev-2", s.done ? "text-subtle line-through" : "text-fg")}>
                  {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald" /> : <Circle className="h-4 w-4 text-subtle" />}
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bell className="h-4 w-4 text-subtle" /> Case Radar
              {unread ? <Badge tone="accent">{unread} new</Badge> : null}
            </div>
            <Link href="/app/radar" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              All alerts <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {alerts.length ? (
            <ul className="divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.id} className="py-2.5">
                  <Link href="/app/radar" className="group block">
                    <div className="flex items-center gap-2">
                      {!a.readAt ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unread" /> : null}
                      <span className="truncate text-sm font-medium group-hover:text-accent">{a.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-subtle">{relativeTime(a.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{a.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              {watches.length ? `Watching ${activeWatches} ${activeWatches === 1 ? "item" : "items"}. New filings and docket changes will appear here.` : "No alerts yet. Watch a person, company, attorney or docket from any result."}
            </p>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="mb-3 text-sm font-semibold">Plan usage</div>
          <ul className="space-y-3">
            {meters.map((m) => (
              <li key={m.label}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{m.label}</span>
                  <span className="tabular-nums text-muted">{m.limit ? `${m.used} / ${m.limit}` : "Not included"}</span>
                </div>
                {m.limit ? (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-elev-2">
                    <div className={cn("h-full rounded-full", m.used / m.limit >= 0.9 ? "bg-amber" : "bg-accent/80")} style={{ width: `${Math.min(100, (m.used / m.limit) * 100)}%` }} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-subtle">Monthly counts reset on the 1st (UTC). Re-opening the same record in a month counts once.</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FolderOpen className="h-4 w-4 text-subtle" /> Projects
            </div>
            <Link href="/app/projects" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              All projects <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {projects.length ? (
            <ul className="divide-y divide-line">
              {projects.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <Link href={`/app/projects/${p.id}`} className="flex items-center gap-2 py-2.5 text-sm hover:text-accent">
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    {p.role !== "owner" ? <Badge>Shared</Badge> : null}
                    <span className="text-xs text-subtle">{p.itemCount} items</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{plan.features.researchWorkspaces ? "Collect dockets, filings, notes and AI briefs in one place." : "Research workspaces are included in Research Pro."}</p>
          )}
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bookmark className="h-4 w-4 text-subtle" /> Saved searches
            </div>
            <Link href="/app/saved" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Manage <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {saved.length ? (
            <ul className="divide-y divide-line">
              {saved.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <Link href={searchHref(s.query, s.entityType, s.filters)} className="flex items-center gap-2 py-2.5 text-sm hover:text-accent">
                    <Search className="h-3.5 w-3.5 text-subtle" />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-subtle">{relativeTime(s.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Save a search from the results page to re-run it in one click.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
