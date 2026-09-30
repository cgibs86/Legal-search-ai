import Link from "next/link";
import { SITE } from "@/lib/config/site";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-elev-2 stroke-line-strong" strokeWidth="1" />
      <g className="stroke-accent" strokeWidth="1.6" strokeLinecap="round">
        <path d="M9 11 L16 16 L23 10" />
        <path d="M16 16 L14 23.5" />
        <path d="M16 16 L23.5 21" />
      </g>
      <circle cx="9" cy="11" r="2.6" className="fill-cyan" />
      <circle cx="23" cy="10" r="2.2" className="fill-fg" />
      <circle cx="14" cy="23.5" r="2.2" className="fill-fg" />
      <circle cx="23.5" cy="21" r="2" className="fill-accent" />
      <circle cx="16" cy="16" r="3.2" className="fill-accent" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2.5", className)} aria-label={`${SITE.name} home`}>
      <LogoMark className="transition-transform group-hover:rotate-[-6deg]" />
      <span className="text-[15px] font-semibold tracking-tight">
        Legal Search <span className="text-accent">AI</span>
      </span>
    </Link>
  );
}
