import Link from "next/link";
import { Logo } from "./Logo";
import { LEGAL_LINES, SITE } from "@/lib/config/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-bg">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm text-sm text-muted">{SITE.coverageLine}</p>
          <p className="max-w-sm text-xs leading-relaxed text-subtle">{LEGAL_LINES.fcra}</p>
        </div>
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Product</div>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link className="hover:text-fg" href="/search">Search</Link></li>
            <li><Link className="hover:text-fg" href="/search?mode=docket">Docket search</Link></li>
            <li><Link className="hover:text-fg" href="/pricing">Pricing</Link></li>
            <li><Link className="hover:text-fg" href="/coverage">Coverage Ledger</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Legal</div>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link className="hover:text-fg" href="/legal/terms">Terms of Service</Link></li>
            <li><Link className="hover:text-fg" href="/legal/acceptable-use">Acceptable use &amp; FCRA</Link></li>
            <li><Link className="hover:text-fg" href="/legal/privacy">Privacy</Link></li>
            <li><Link className="hover:text-fg" href="/legal/disclaimer">Record accuracy</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Data</div>
          <ul className="space-y-2 text-sm text-muted">
            <li>
              Case data from{" "}
              <a className="underline decoration-line-strong hover:text-fg" href="https://www.courtlistener.com/" target="_blank" rel="noreferrer">
                CourtListener
              </a>{" "}
              (Free Law Project)
            </li>
            <li><Link className="hover:text-fg" href="/coverage">What we search — and don&apos;t</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-subtle sm:px-6 md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} {SITE.name}. {LEGAL_LINES.advice}</span>
          <span>{LEGAL_LINES.identity}</span>
        </div>
      </div>
    </footer>
  );
}
