"use client";
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";

/** NFR-013: clear message when offline; NFR-014 queue status. */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    const q = () =>
      import("@/lib/client/offline-queue")
        .then((m) => m.queueCount())
        .then(setQueued)
        .catch(() => { });
    q();
    const t = setInterval(q, 5000);
    window.addEventListener("mt-queue-changed", q);
    window.addEventListener("mt-queue-synced", q);
    const flush = () =>
      import("@/lib/client/offline-queue")
        .then((m) => m.flushQueue())
        .then(q)
        .catch(() => { });
    window.addEventListener("online", flush);
    if (navigator.onLine) flush();
    return () => {
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
      window.removeEventListener("online", flush);
      clearInterval(t);
    };
  }, []);
  if (online && queued === 0) return null;
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="flex items-center justify-center gap-2 bg-[var(--color-bad)] px-3 py-2 text-center text-sm font-semibold text-white no-print"
    >
      {!online ? <CloudOff size={16} aria-hidden className="shrink-0" /> : <RefreshCw size={16} aria-hidden className="shrink-0" />}
      <span>
        {!online ? "You are offline. Lookup and scanning use the cached copy; actions that change data need a connection" : ""}
        {!online && queued > 0 ? " · " : ""}
        {queued > 0 ? `${queued} action(s) queued — pending, NOT confirmed until synced` : ""}
      </span>
    </div>
  );
}

/** Small header indicator: online / offline / queued actions (supplements the banner). */
export function SyncPill() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => {
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
    };
  }, []);
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)] md:inline-flex"
      title={online ? "Connected" : "Offline — changes are queued"}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: online ? "var(--color-ok)" : "var(--color-bad)" }} aria-hidden />
      {online ? "Online" : "Offline"}
    </span>
  );
}

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { });
    }

    import("@/lib/client/photo-uploader")
      .then((m) => m.resumePendingUploads())
      .catch(() => { });
  }, []);

  return null;
}
