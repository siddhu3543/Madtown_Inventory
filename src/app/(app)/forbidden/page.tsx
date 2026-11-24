import Link from "next/link";
import { Lock } from "lucide-react";
export const metadata = { title: "Not allowed" };
export default function Forbidden() {
  return (
    <div className="card mx-auto mt-8 max-w-lg p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
        <Lock size={24} aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold">Your role cannot open this page.</h1>
      <p className="muted mt-2">Ask an Admin if you need access.</p>
      <Link href="/" className="btn btn-primary mt-5">
        Back to dashboard
      </Link>
    </div>
  );
}
