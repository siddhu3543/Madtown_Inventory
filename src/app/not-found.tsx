import Link from "next/link";
import { Compass } from "lucide-react";
export const metadata = { title: "Not found" };
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <div className="card p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-wash)] text-[var(--color-muted)]">
          <Compass size={24} aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
        <p className="muted mt-2">That page or item does not exist, or the link is out of date.</p>
        <Link href="/" className="btn btn-primary mt-5">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
