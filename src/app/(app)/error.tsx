"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-8 max-w-lg p-8 text-center" role="alert">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-bad-soft)] text-[var(--color-bad)]">
        <AlertTriangle size={24} aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold">Something went wrong</h1>
      <p className="muted mt-2">The action did not complete. Nothing was saved partially — every change runs in one database transaction.</p>
      {error.digest && <p className="muted mt-2 text-sm">Reference: {error.digest}</p>}
      <button className="btn btn-primary mt-5" onClick={reset}>
        <RotateCcw size={16} aria-hidden /> Try again
      </button>
    </div>
  );
}
