"use client";
import { useEffect, useState } from "react";

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
        .catch(() => {});
    q();
    const t = setInterval(q, 5000);
    window.addEventListener("mt-queue-changed", q);
    window.addEventListener("mt-queue-synced", q);
    const flush = () =>
      import("@/lib/client/offline-queue")
        .then((m) => m.flushQueue())
        .then(q)
        .catch(() => {});
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
    <div role="status" data-testid="offline-banner" className="bg-[var(--color-bad)] px-3 py-2 text-center font-semibold text-white">
      {!online ? "You are offline. Lookup and scanning use the cached copy; actions that change data need a connection" : ""}
      {!online && queued > 0 ? " · " : ""}
      {queued > 0 ? `${queued} action(s) queued — pending, NOT confirmed until synced` : ""}
    </div>
  );
}

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    import("@/lib/client/photo-uploader").then((m) => m.resumePendingUploads()).catch(() => {});
  }, []);
  return null;
}
