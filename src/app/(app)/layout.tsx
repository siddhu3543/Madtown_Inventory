import Link from "next/link";
import { ScanLine, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { navGroups, Nav } from "@/components/Nav";
import { OfflineBanner, SwRegister, SyncPill } from "@/components/Offline";
import { Brand } from "@/components/shell/Brand";
import { MobileNav } from "@/components/shell/MobileNav";
import { RailToggle } from "@/components/shell/RailToggle";
import { UserMenu } from "@/components/shell/UserMenu";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const staging = env.appEnv !== "production";
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]">
      <aside className="app-sidebar no-print sticky top-0 z-20 hidden h-dvh flex-col border-r border-[var(--color-line)] bg-[var(--color-sidebar)] lg:flex">
        <div className="flex h-14 items-center border-b border-[var(--color-line)] px-4 [:root[data-rail='1']_&]:justify-center [:root[data-rail='1']_&]:px-0">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <Nav user={user} />
        </div>
        <div className="border-t border-[var(--color-line)] p-3">
          <RailToggle />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        {staging && (
          <div className="bg-[var(--color-warn)] px-3 py-1 text-center text-xs font-bold tracking-wide text-white no-print" data-testid="env-banner">
            {env.appEnv.toUpperCase()} — synthetic data, emails sandboxed
          </div>
        )}
        <OfflineBanner />
        <SwRegister />
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-paper)_92%,transparent)] px-3 backdrop-blur sm:px-5">
          <MobileNav groups={navGroups(user)} brand={<Brand />} />
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <form action="/items" method="get" role="search" className="relative ml-2 hidden max-w-md flex-1 md:block">
            <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-muted)]" />
            <input name="q" type="search" className="input !min-h-9 !pl-9" placeholder="Search items by ID, name, model…" aria-label="Search inventory" autoComplete="off" />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <SyncPill />
            <Link href="/scan" className="btn btn-primary" data-testid="scan-button">
              <ScanLine size={18} aria-hidden /> Scan
            </Link>
            <UserMenu name={user.name} email={user.email} role={user.role} developer={user.isDeveloper} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
