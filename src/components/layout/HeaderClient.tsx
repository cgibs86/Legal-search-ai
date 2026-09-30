"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, FolderOpen, LayoutDashboard, LogOut, Menu, Radar, Search, Settings, Shield, X } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Badge, ButtonLink } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

interface HeaderViewer {
  kind: "anonymous" | "user" | "demo";
  email: string | null;
  plan: string;
  planName: string;
  isAdmin: boolean;
  demo: boolean;
}

const PUBLIC_NAV = [
  { href: "/search", label: "Search" },
  { href: "/coverage", label: "Coverage" },
  { href: "/pricing", label: "Pricing" },
];

export function HeaderClient({ viewer, unread, authEnabled, variant }: { viewer: HeaderViewer; unread: number; authEnabled: boolean; variant: "default" | "transparent" }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const signedIn = viewer.kind !== "anonymous";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  async function signOut() {
    if (viewer.demo) {
      await fetch("/api/demo", { method: "DELETE" });
    } else {
      await getSupabaseBrowser()?.auth.signOut();
    }
    router.push("/");
    router.refresh();
  }

  const appNav = signedIn
    ? [
        { href: "/app", label: "Workspace", icon: LayoutDashboard },
        { href: "/app/projects", label: "Projects", icon: FolderOpen },
        { href: "/app/radar", label: "Case Radar", icon: Radar },
      ]
    : [];

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full print:hidden transition-[background,border-color,backdrop-filter] duration-300",
        scrolled || variant === "default" ? "border-b border-line bg-bg/80 backdrop-blur-xl" : "border-b border-transparent bg-transparent",
      )}
    >
      {viewer.demo ? (
        <div className="bg-amber-soft px-4 py-1.5 text-center text-xs font-medium text-amber">
          Demo workspace · labeled sample data · not a real account ({viewer.planName} plan preview)
        </div>
      ) : null}
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          {PUBLIC_NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-lg px-3 py-1.5 text-sm transition", pathname.startsWith(n.href) ? "text-fg bg-elev-2" : "text-muted hover:text-fg")}>
              {n.label}
            </Link>
          ))}
          {/* Desktop shows one Workspace entry; the workspace has its own section nav. */}
          {appNav.slice(0, 1).map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-lg px-3 py-1.5 text-sm transition", pathname.startsWith("/app") ? "text-fg bg-elev-2" : "text-muted hover:text-fg")}>
              {n.label}
            </Link>
          ))}
          {viewer.isAdmin ? (
            <Link href="/admin" className={cn("rounded-lg px-3 py-1.5 text-sm transition", pathname.startsWith("/admin") ? "text-fg bg-elev-2" : "text-muted hover:text-fg")}>
              Admin
            </Link>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Link href="/search" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-elev-2 hover:text-fg md:hidden" aria-label="Search">
            <Search className="h-4 w-4" />
          </Link>
          {signedIn ? (
            <Link href="/app/radar" className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-elev-2 hover:text-fg" aria-label={`Alerts${unread ? ` (${unread} unread)` : ""}`}>
              <Bell className="h-4 w-4" />
              {unread > 0 ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose ring-2 ring-bg" /> : null}
            </Link>
          ) : null}
          <ThemeToggle />
          {signedIn ? (
            <div className="hidden items-center gap-2 md:flex">
              <Link href="/app/settings" className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted hover:bg-elev-2 hover:text-fg">
                <Badge tone={viewer.plan === "free" ? "neutral" : "accent"}>{viewer.planName}</Badge>
                <Settings className="h-4 w-4" />
              </Link>
              <button onClick={signOut} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-elev-2 hover:text-fg" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <ButtonLink href={authEnabled ? "/login" : "/demo"} variant="ghost" size="sm">
                {authEnabled ? "Log in" : "Demo workspace"}
              </ButtonLink>
              <ButtonLink href={authEnabled ? "/signup" : "/pricing"} size="sm">
                {authEnabled ? "Start free trial" : "See plans"}
              </ButtonLink>
            </div>
          )}
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-elev-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="border-t border-line bg-bg/95 backdrop-blur-xl md:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3" aria-label="Mobile">
              {[...PUBLIC_NAV, ...appNav].map((n) => (
                <Link key={n.href} href={n.href} className="rounded-xl px-3 py-3 text-base text-fg hover:bg-elev-2">
                  {n.label}
                </Link>
              ))}
              {viewer.isAdmin ? (
                <Link href="/admin" className="flex items-center gap-2 rounded-xl px-3 py-3 text-base text-fg hover:bg-elev-2">
                  <Shield className="h-4 w-4" /> Admin
                </Link>
              ) : null}
              <div className="mt-2 flex gap-2 border-t border-line pt-3">
                {signedIn ? (
                  <>
                    <ButtonLink href="/app/settings" variant="secondary" className="flex-1 justify-center">
                      Settings
                    </ButtonLink>
                    <button onClick={signOut} className="flex-1 rounded-xl border border-line px-4 text-sm">
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <ButtonLink href={authEnabled ? "/login" : "/demo"} variant="secondary" className="flex-1 justify-center">
                      {authEnabled ? "Log in" : "Demo workspace"}
                    </ButtonLink>
                    <ButtonLink href={authEnabled ? "/signup" : "/pricing"} className="flex-1 justify-center">
                      {authEnabled ? "Start free trial" : "See plans"}
                    </ButtonLink>
                  </>
                )}
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
