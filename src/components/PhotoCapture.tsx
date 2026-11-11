"use client";
import { useEffect, useState } from "react";
import { compressImage } from "@/lib/client/image";
import { uploadInBackground } from "@/lib/client/photo-uploader";

type P = { id: string; url: string; state: "uploading" | "uploaded" | "failed" };

/** Camera capture inside the app (FR-PHO-003). Emits hidden inputs `photo_ids` for the enclosing form. */
export function PhotoCapture({
  itemId,
  kind,
  name = "photo_ids",
  label,
  required,
  link,
}: {
  itemId: string | null;
  kind: string;
  name?: string;
  label?: string;
  required?: boolean;
  link?: Record<string, string>;
}) {
  const [photos, setPhotos] = useState<P[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ok = (e: Event) => setPhotos((ps) => ps.map((p) => (p.id === (e as CustomEvent).detail ? { ...p, state: "uploaded" } : p)));
    const bad = (e: Event) => setPhotos((ps) => ps.map((p) => (p.id === (e as CustomEvent).detail ? { ...p, state: "failed" } : p)));
    window.addEventListener("mt-photo-uploaded", ok);
    window.addEventListener("mt-photo-failed", bad);
    return () => {
      window.removeEventListener("mt-photo-uploaded", ok);
      window.removeEventListener("mt-photo-failed", bad);
    };
  }, []);
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const c = await compressImage(f);
        const r = await fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: itemId, kind, mime: "image/jpeg", width: c.width, height: c.height, bytes: c.full.size, ...(link ?? {}) }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message ?? "Could not save photo");
        setPhotos((ps) => [...ps, { id: j.id, url: URL.createObjectURL(c.thumb), state: "uploading" }]);
        void uploadInBackground(j.id, c.full, c.thumb);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="field" data-testid={`photo-capture-${kind}`}>
      <span>
        {label ?? `${kind} photos`}
        {required ? " (required)" : " (optional)"}
      </span>
      <label className="btn btn-secondary w-full">
        {busy ? "Processing…" : "📷 Take or add photo"}
        <input type="file" accept="image/*" capture="environment" multiple className="sr-only" data-testid={`photo-input-${kind}`} onChange={(e) => onFiles(e.target.files)} />
      </label>
      {err && (
        <p role="alert" className="font-semibold text-[var(--color-bad)]">
          {err}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="captured" className="h-20 w-20 rounded-md object-cover" />
            <span className="badge absolute bottom-1 left-1 bg-[var(--color-paper)] text-xs" data-testid="photo-state">
              {p.state === "uploaded" ? "saved" : p.state === "failed" ? "retrying" : "uploading"}
            </span>
            <input type="hidden" name={name} value={p.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
