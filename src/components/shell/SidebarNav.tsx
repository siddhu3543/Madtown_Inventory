"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Boxes,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  FileUp,
  Inbox,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScrollText,
  SearchX,
  Settings,
  ShoppingCart,
  Tag,
  Users,
  Wrench,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = { label: string; links: { href: string; label: string; icon: string; phase?: 1 | 2 | 3 }[] };

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  items: Package,
  kits: Boxes,
  labels: Tag,
  unsorted: Inbox,
  lost: SearchX,
  loans: ArrowLeftRight,
  people: Users,
  reservations: CalendarClock,
  repairs: Wrench,
  walkthrough: ClipboardCheck,
  tobuy: ShoppingCart,
  orders: ReceiptText,
  reports: BarChart3,
  audit: ScrollText,
  import: FileUp,
  settings: Settings,
};

/** Spinner shown on a nav link while its route is loading (must render inside the <Link>). */

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

/**
 * Grouped sidebar navigation. Groups collapse (state remembered per browser); the group that holds the
 * current page is never hidden. In the desktop "rail" mode labels are hidden and shown as tooltips (title).
 */
export function SidebarNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const path = usePathname();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const s = localStorage.getItem("mt-nav-closed");
      if (s) setClosed(JSON.parse(s));
    } catch {
      /* storage unavailable: groups stay open */
    }
  }, []);
  function toggle(label: string) {
    setClosed((c) => {
      const n = { ...c, [label]: !c[label] };
      try {
        localStorage.setItem("mt-nav-closed", JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  }
  return (
    <nav aria-label="Main" className="flex flex-col gap-3">
      {groups.map((g) => {
        const hasActive = g.links.some((l) => isActive(path, l.href));
        const open = !closed[g.label] || hasActive;
        const single = g.links.length === 1 && g.label === "Overview";
        return (
          <div key={g.label}>
            {!single && (
              <button
                type="button"
                onClick={() => toggle(g.label)}
                aria-expanded={open}
                className="rail-hide group mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                {g.label}
                <ChevronDown size={14} aria-hidden className={`transition-transform ${open ? "" : "-rotate-90"}`} />
              </button>
            )}
            {!single && <div className="rail-only mx-3 mb-1 hidden h-px bg-[var(--color-line)]" aria-hidden />}
            {open && (
              <ul className="flex flex-col gap-0.5">
                {g.links.map((l) => {
                  const Icon = ICONS[l.icon] ?? Package;
                  const active = isActive(path, l.href);
                  return (
                    <li key={l.href}>
                      <Link href={l.href} className="nav-link" aria-current={active ? "page" : undefined} title={l.label} onClick={onNavigate}>
                        <Icon size={18} aria-hidden />
                        <span className="rail-hide min-w-0 flex-1 truncate">{l.label}</span>
                        {l.phase && l.phase > 1 && (
                          <span
                            className="rail-hide rounded border border-[var(--color-line)] px-1 text-[0.625rem] font-semibold leading-4 text-[var(--color-muted)] opacity-70"
                            title={`Phase ${l.phase} feature`}
                          >
                            P{l.phase}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
