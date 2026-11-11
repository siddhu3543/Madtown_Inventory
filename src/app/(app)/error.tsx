"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card p-6" role="alert">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="mt-2">The action did not complete. Nothing was saved partially — every change runs in one database transaction.</p>
      {error.digest && <p className="muted mt-2 text-sm">Reference: {error.digest}</p>}
      <button className="btn btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
