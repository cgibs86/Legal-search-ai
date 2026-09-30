"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bookmark, CreditCard, FolderOpen, LayoutDashboard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/app/projects", label: "Projects", icon: FolderOpen },
  { href: "/app/radar", label: "Case Radar", icon: Bell },
  { href: "/app/saved", label: "Saved searches", icon: Bookmark },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-thin -mx-1 mb-6 flex gap-1 overflow-x-auto px-1 print:hidden" aria-label="Workspace">
      {ITEMS.map((i) => {
        const active = i.exact ? pathname === i.href : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition", active ? "bg-elev-2 text-fg" : "text-muted hover:bg-elev-2 hover:text-fg")} aria-current={active ? "page" : undefined}>
            <i.icon className="h-4 w-4" />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
