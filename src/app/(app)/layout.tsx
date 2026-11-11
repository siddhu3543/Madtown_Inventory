import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { OfflineBanner, SwRegister } from "@/components/Offline";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const staging = env.appEnv !== "production";
  return (
    <div className="min-h-screen">
      {staging && (
        <div className="bg-[var(--color-warn)] px-3 py-1 text-center text-sm font-bold text-white no-print" data-testid="env-banner">
          {env.appEnv.toUpperCase()} — synthetic data, emails sandboxed
        </div>
      )}
      <OfflineBanner />
      <SwRegister />
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 no-print">
        <details className="relative lg:hidden">
          <summary className="btn btn-secondary btn-sm list-none" aria-label="Menu">
            ☰
          </summary>
          <div className="card absolute left-0 top-12 z-30 w-64 p-2 shadow-lg">
            <Nav user={user} />
          </div>
        </details>
        <Link href="/" className="mr-auto text-lg font-extrabold text-[var(--color-ink)] no-underline">
          Madtown Inventory
        </Link>
        <Link href="/scan" className="btn btn-primary" data-testid="scan-button">
          Scan
        </Link>
        <details className="relative">
          <summary className="btn btn-secondary btn-sm list-none" data-testid="user-menu">
            {user.name.split(" ")[0]}
          </summary>
          <div className="card absolute right-0 top-12 z-30 w-64 p-3 shadow-lg">
            <p className="font-semibold">{user.name}</p>
            <p className="muted text-sm">{user.email}</p>
            <p className="mt-1 text-sm">
              Role: <b data-testid="user-role">{user.role}</b>
              {user.isDeveloper ? " · developer" : ""}
            </p>
            <form action="/api/auth/logout" method="post" className="mt-3">
              <button className="btn btn-secondary btn-sm w-full">Sign out</button>
            </form>
          </div>
        </details>
      </header>
      <div className="mx-auto flex max-w-7xl gap-4 px-3 py-4">
        <aside className="hidden w-56 shrink-0 lg:block no-print">
          <div className="card sticky top-20 p-2">
            <Nav user={user} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
