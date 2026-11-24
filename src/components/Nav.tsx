import type { CurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SidebarNav, type NavGroup } from "@/components/shell/SidebarNav";

type L = { href: string; label: string; icon: string; phase?: 1 | 2 | 3; show?: (u: CurrentUser) => boolean };
type G = { label: string; links: L[] };

/**
 * Navigation structure. Every existing route is kept; only grouping and icons are new.
 * Staff see only the desk (dashboard, items, kits, loans); every other link is Admin-only (`show`).
 */
const GROUPS: G[] = [
  { label: "Overview", links: [{ href: "/", label: "Dashboard", icon: "dashboard" }] },
  {
    label: "Inventory",
    links: [
      { href: "/items", label: "Items", icon: "items" },
      { href: "/kits", label: "Kits", icon: "kits", phase: 2 },
      { href: "/labels", label: "Labels", icon: "labels", show: (u) => can.labels(u) },
      { href: "/unsorted", label: "Unsorted", icon: "unsorted", show: (u) => can.unsorted(u) },
      { href: "/lost", label: "Lost & found", icon: "lost", show: (u) => can.lostAndFound(u) },
    ],
  },
  {
    label: "Operations",
    links: [
      { href: "/loans", label: "Loans", icon: "loans" },
      { href: "/people", label: "People", icon: "people", show: (u) => can.people(u) },
      { href: "/reservations", label: "Reservations", icon: "reservations", phase: 2, show: (u) => can.reservations(u) },
      { href: "/repairs", label: "Repairs", icon: "repairs", phase: 2, show: (u) => can.repairs(u) },
      { href: "/walkthrough", label: "Walkthrough", icon: "walkthrough", phase: 2, show: (u) => can.walkthrough(u) },
    ],
  },
  {
    label: "Purchasing",
    links: [
      { href: "/to-buy", label: "To-buy", icon: "tobuy", phase: 2, show: (u) => can.proposeBuy(u) },
      { href: "/orders", label: "Orders", icon: "orders", phase: 2, show: (u) => can.viewOrders(u) },
    ],
  },
  {
    label: "Insights",
    links: [
      { href: "/reports", label: "Reports", icon: "reports", show: (u) => can.reports(u) },
      { href: "/audit-log", label: "Audit log", icon: "audit", show: (u) => can.globalAudit(u) },
    ],
  },
  {
    label: "Administration",
    links: [
      { href: "/import", label: "Import review", icon: "import", show: (u) => can.importReview(u) },
      { href: "/settings", label: "Settings", icon: "settings", show: (u) => can.settings(u) },
    ],
  },
];

export function navGroups(user: CurrentUser): NavGroup[] {
  return GROUPS.map((g) => ({
    label: g.label,
    links: g.links.filter((l) => !l.show || l.show(user)).map(({ href, label, icon, phase }) => ({ href, label, icon, phase })),
  })).filter((g) => g.links.length > 0);
}

export function Nav({ user }: { user: CurrentUser }) {
  return <SidebarNav groups={navGroups(user)} />;
}
