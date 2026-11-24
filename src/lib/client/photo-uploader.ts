import { openDB } from "idb";
/**
 * NFR-002: upload runs in the background and never blocks the check-out/in save.
 * A4: failed uploads stay in IndexedDB and retry; the server shows "evidence incomplete" until done.
 */
const db = () => openDB("mt-photos", 1, { upgrade: (d) => d.createObjectStore("pending", { keyPath: "id" }) });

export async function uploadInBackground(id: string, full: Blob, thumb: Blob) {
  try {
    await (await db()).put("pending", { id, full, thumb, at: Date.now() });
  } catch {
    /* private mode: still try once */
  }
  void tryUpload(id, full, thumb);
}

async function tryUpload(id: string, full: Blob, thumb: Blob): Promise<boolean> {
  const fd = new FormData();
  fd.append("file", full, `${id}.jpg`);
  fd.append("thumb", thumb, `${id}-thumb.jpg`);
  let reason = "No connection — it will retry when you are back online.";
  try {
    const r = await fetch(`/api/photos/${id}/upload`, { method: "PUT", body: fd });
    if (r.ok) {
      try {
        await (await db()).delete("pending", id);
      } catch {}
      window.dispatchEvent(new CustomEvent("mt-photo-uploaded", { detail: id }));
      return true;
    }
    // show the server's reason instead of a silent "retrying" (the cause of failed uploads was invisible before)
    const j = await r.json().catch(() => null);
    reason = (j?.message as string | undefined) ?? `Upload failed (HTTP ${r.status}).`;
    if (r.status === 413) reason = "The photo is too large to upload.";
  } catch {
    /* offline */
  }
  window.dispatchEvent(new CustomEvent("mt-photo-failed", { detail: id }));
  window.dispatchEvent(new CustomEvent("mt-photo-error", { detail: { id, reason } }));
  return false;
}

export async function resumePendingUploads() {
  let all: { id: string; full: Blob; thumb: Blob }[] = [];
  try {
    all = await (await db()).getAll("pending");
  } catch {
    return;
  }
  for (const p of all) await tryUpload(p.id, p.full, p.thumb);
}
export async function pendingUploadCount() {
  try {
    return (await (await db()).getAll("pending")).length;
  } catch {
    return 0;
  }
}
