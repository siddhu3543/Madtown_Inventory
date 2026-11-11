import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

type L = { href: string; label: string; phase?: 1 | 2 | 3; show?: (u: CurrentUser) => boolean };
const LINKS: L[] = [
  { href: "/", label: "Home" },
  { href: "/items", label: "Items" },
  { href: "/loans", label: "Loans" },
  { href: "/people", label: "People" },
  { href: "/kits", label: "Kits", phase: 2 },
  { href: "/reservations", label: "Reservations", phase: 2 },
  { href: "/repairs", label: "Repairs", phase: 2 },
  { href: "/lost", label: "Lost & found" },
  { href: "/to-buy", label: "To-buy", phase: 2 },
  { href: "/orders", label: "Orders", phase: 2, show: (u) => can.viewOrders(u) },
  { href: "/walkthrough", label: "Walkthrough", phase: 2 },
  { href: "/reports", label: "Reports" },
  { href: "/labels", label: "Print labels", show: (u) => can.labels(u) },
  { href: "/unsorted", label: "Unsorted", show: (u) => can.unsorted(u) },
  { href: "/import", label: "Import review", show: (u) => can.importReview(u) },
  { href: "/audit-log", label: "Audit log", show: (u) => can.globalAudit(u) },
  { href: "/settings", label: "Settings", show: (u) => can.settings(u) },
];

export function Nav({ user }: { user: CurrentUser }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {LINKS.filter((l) => !l.show || l.show(user)).map((l) => (
        <Link key={l.href} href={l.href} className="rounded-md px-3 py-2.5 font-semibold text-[var(--color-ink)] no-underline hover:bg-[var(--color-wash)]">
          {l.label} {l.phase && l.phase > 1 && <span className="phase">P{l.phase}</span>}
        </Link>
      ))}
    </nav>
  );
}
