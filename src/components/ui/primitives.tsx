"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "xs" | "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-[0_8px_24px_-10px_var(--glow)]",
  secondary: "bg-elev-2 text-fg hover:bg-inset border border-line",
  ghost: "text-muted hover:text-fg hover:bg-elev-2",
  outline: "border border-line-strong text-fg hover:bg-elev-2",
  danger: "bg-rose text-white hover:opacity-90",
  subtle: "bg-accent-soft text-accent hover:bg-accent-soft/80",
};
const sizes: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center font-medium transition-[background,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "primary", size = "md", className, children, ...rest }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; prefetch?: boolean; target?: string; rel?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center font-medium transition-colors duration-150 whitespace-nowrap", variants[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-elev shadow-card", className)} {...props} />;
}

type Tone = "neutral" | "accent" | "cyan" | "amber" | "emerald" | "rose" | "violet";
const tones: Record<Tone, string> = {
  neutral: "bg-elev-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  cyan: "bg-cyan-soft text-cyan border-transparent",
  amber: "bg-amber-soft text-amber border-transparent",
  emerald: "bg-emerald-soft text-emerald border-transparent",
  rose: "bg-rose-soft text-rose border-transparent",
  violet: "bg-violet-soft text-violet border-transparent",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide leading-none", tones[tone], className)}>
      {children}
    </span>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-xl border border-line bg-elev px-3 text-sm text-fg placeholder:text-subtle outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn("w-full rounded-xl border border-line bg-elev px-3 py-2 text-sm text-fg placeholder:text-subtle outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft", className)}
      {...props}
    />
  );
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("h-9 w-full rounded-lg border border-line bg-elev px-2.5 text-sm text-fg outline-none focus:border-accent", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-xs font-medium text-muted", className)}>
      {children}
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-elev-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle", className)}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition", checked ? "bg-accent border-accent" : "bg-elev-2 border-line-strong")}
    >
      <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

export function Notice({ tone = "neutral", title, children, icon, className, action }: { tone?: "neutral" | "amber" | "rose" | "accent" | "emerald"; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string; action?: ReactNode }) {
  const map = {
    neutral: "border-line bg-elev-2",
    amber: "border-amber/30 bg-amber-soft",
    rose: "border-rose/30 bg-rose-soft",
    accent: "border-accent/30 bg-accent-soft",
    emerald: "border-emerald/30 bg-emerald-soft",
  } as const;
  return (
    <div className={cn("flex gap-3 rounded-xl border px-3.5 py-3 text-sm", map[tone], className)} role={tone === "rose" ? "alert" : "status"}>
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold text-fg">{title}</div> : null}
        {children ? <div className="text-muted mt-0.5 leading-relaxed">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-subtle">{icon}</div> : null}
      <div className="text-base font-semibold">{title}</div>
      {children ? <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
