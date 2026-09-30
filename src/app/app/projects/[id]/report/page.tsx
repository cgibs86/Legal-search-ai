import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getRepo } from "@/lib/data/repo";
import { resolveDataMode } from "@/lib/config/env";
import { LEGAL_LINES, SITE } from "@/lib/config/site";
import { PrintButton } from "@/components/app/PrintButton";
import { describeItem, ITEM_KIND_LABEL, ITEM_KIND_ORDER } from "@/lib/ui/projectItems";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Project report" };

/**
 * Print-ready project report. "Save as PDF" uses the browser's print dialog, which keeps
 * links, text selection and accessibility — no server-side PDF renderer to maintain.
 */
export default async function ReportPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const viewer = await getViewer();
  const repo = await getRepo(viewer);
  const data = await repo?.getProject(id).catch(() => null);
  if (!data) notFound();
  const { project, items } = data;
  const demo = viewer.demo || resolveDataMode() === "demo";
  const groups = ITEM_KIND_ORDER.map((k) => ({ kind: k, items: items.filter((i) => i.kind === k) })).filter((g) => g.items.length);
  const generated = new Date().toISOString();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href={`/app/projects/${id}`} className="text-sm text-muted hover:text-fg">
          ← Back to project
        </Link>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-3xl rounded-2xl bg-white p-8 text-zinc-900 shadow-card print:max-w-none print:rounded-none print:p-0 print:shadow-none sm:p-12">
        <header className="border-b border-zinc-200 pb-5">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{SITE.name} · Research report</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1>
          {project.description ? <p className="mt-2 text-zinc-600">{project.description}</p> : null}
          <div className="mt-3 text-xs text-zinc-500">
            Generated {formatDate(generated, { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} · {items.length} saved items
          </div>
          {demo ? <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">DEMO SNAPSHOT — contains labeled sample data, not live court data.</div> : null}
        </header>

        {groups.length ? (
          groups.map((g) => (
            <section key={g.kind} className="mt-7 break-inside-avoid-page">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {ITEM_KIND_LABEL[g.kind]} ({g.items.length})
              </h2>
              <ol className="mt-3 space-y-4">
                {g.items.map((i) => {
                  const d = describeItem(i);
                  return (
                    <li key={i.id} className="break-inside-avoid">
                      <div className="font-medium">{i.title}</div>
                      {d.meta.length ? <div className="text-sm text-zinc-600">{d.meta.join(" · ")}</div> : null}
                      {typeof i.ref.description === "string" ? <p className="mt-1 text-sm text-zinc-700">{i.ref.description}</p> : null}
                      {d.brief ? (
                        <div className="mt-2 space-y-2 border-l-2 border-zinc-200 pl-3 text-sm">
                          {d.brief.sections
                            .filter((s) => !s.insufficient)
                            .map((s) => (
                              <div key={s.key}>
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{s.title}</div>
                                {s.statements.map((st, k) => (
                                  <p key={k}>
                                    {st.text} <span className="font-mono text-[10px] text-zinc-500">[{st.sources.map((x) => x.id).join(", ")}]</span>
                                  </p>
                                ))}
                              </div>
                            ))}
                          <div className="text-[11px] text-zinc-500">
                            Sources: {d.brief.sources.map((s) => `${s.id} ${s.label}${s.url ? ` (${s.url})` : ""}`).join("; ")}
                          </div>
                        </div>
                      ) : null}
                      {i.note ? <p className="mt-1 whitespace-pre-line text-sm">{i.kind === "note" ? i.note : `Note: ${i.note}`}</p> : null}
                      {d.source ? (
                        <a href={d.source} className="mt-0.5 block break-all text-xs text-blue-700 underline">
                          {d.source}
                        </a>
                      ) : null}
                      <div className="text-[11px] text-zinc-400">Saved {formatDate(i.createdAt)}</div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        ) : (
          <p className="mt-6 text-zinc-600">This project has no saved items yet.</p>
        )}

        <footer className="mt-10 space-y-1.5 border-t border-zinc-200 pt-4 text-[11px] leading-relaxed text-zinc-500">
          <p>{LEGAL_LINES.identity}</p>
          <p>{LEGAL_LINES.allegations}</p>
          <p>{LEGAL_LINES.completeness}</p>
          <p>{LEGAL_LINES.advice}</p>
          <p>{LEGAL_LINES.fcra}</p>
          <p>Court data: CourtListener (Free Law Project) and other sources as labeled on each record.</p>
        </footer>
      </article>
    </div>
  );
}
