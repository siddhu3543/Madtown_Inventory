import { CloudOff, ScanLine } from "lucide-react";
export const metadata = { title: "Offline" };
export default function Offline() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <div className="card p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-wash)] text-[var(--color-muted)]">
          <CloudOff size={24} aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold">You are offline</h1>
        <p className="muted mt-2">
          Pages you opened recently, the item list and the scanner still work from the cached copy. Actions that change data need a connection; check-outs and check-ins you make
          offline are queued and are not confirmed until they sync.
        </p>
        <a href="/scan" className="btn btn-primary mt-5 w-full">
          <ScanLine size={18} aria-hidden /> Open scanner
        </a>
      </div>
    </main>
  );
}
