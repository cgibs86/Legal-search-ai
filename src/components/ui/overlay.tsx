"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Sheet: a bottom sheet on phones and a centered dialog (or side panel) on larger screens.
 * Focus is trapped loosely (initial focus + Escape to close) and scroll is locked.
 */
export function Sheet({ open, onClose, title, children, side = "center", className, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; side?: "center" | "right"; className?: string; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
          <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={ref}
            tabIndex={-1}
            initial={side === "right" ? { x: 40, opacity: 0 } : { y: 40, opacity: 0 }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={side === "right" ? { x: 40, opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={cn(
              "absolute flex max-h-[92dvh] flex-col border-line bg-elev shadow-float outline-none",
              "inset-x-0 bottom-0 rounded-t-3xl border-t pb-[env(safe-area-inset-bottom)]",
              side === "center" && "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border",
              side === "right" && "sm:inset-y-0 sm:right-0 sm:left-auto sm:bottom-auto sm:h-dvh sm:max-h-dvh sm:w-[440px] sm:rounded-none sm:border-l sm:border-t-0",
              className,
            )}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
              <div className="text-base font-semibold">{title}</div>
              <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-elev-2 hover:text-fg" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer ? <div className="border-t border-line px-5 py-3">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: "neutral" | "success" | "error";
}

const ToastCtx = createContext<(message: ReactNode, tone?: ToastItem["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: ReactNode, tone: ToastItem["tone"] = "neutral") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)]" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              className={cn(
                "pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm shadow-float backdrop-blur-xl",
                t.tone === "error" ? "border-rose/30 bg-rose-soft text-fg" : t.tone === "success" ? "border-emerald/30 bg-elev text-fg" : "border-line bg-elev text-fg",
              )}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; badge?: ReactNode; locked?: boolean }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1", className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition",
            value === t.id ? "text-fg" : "text-muted hover:text-fg hover:bg-elev-2",
          )}
        >
          {value === t.id ? <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-lg border border-line bg-elev-2" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
          <span className="relative flex items-center gap-1.5">
            {t.label}
            {t.badge}
          </span>
        </button>
      ))}
    </div>
  );
}
