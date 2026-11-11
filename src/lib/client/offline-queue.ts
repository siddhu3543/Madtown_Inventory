import { openDB } from "idb";
/**
 * NFR-014 (Phase 2): check-out/check-in made offline are queued with a client UUID; on reconnect the
 * server validates them (server time wins). Nothing here is shown as confirmed until the server says so.
 */
type Q = { client_uuid: string; kind: "checkout" | "checkin"; payload: Record<string, unknown>; created_at: string; label: string };
const db = () => openDB("mt-queue", 1, { upgrade: (d) => d.createObjectStore("q", { keyPath: "client_uuid" }) });

export async function enqueue(kind: Q["kind"], payload: Record<string, unknown>, label: string) {
  const client_uuid = crypto.randomUUID();
  await (await db()).put("q", { client_uuid, kind, payload: { ...payload, client_uuid }, created_at: new Date().toISOString(), label });
  window.dispatchEvent(new Event("mt-queue-changed"));
  return client_uuid;
}
export async function queueCount() {
  try {
    return await (await db()).count("q");
  } catch {
    return 0;
  }
}
export async function queued(): Promise<Q[]> {
  try {
    return await (await db()).getAll("q");
  } catch {
    return [];
  }
}
export async function flushQueue() {
  const items = await queued();
  if (!items.length || !navigator.onLine) return { synced: 0 };
  const r = await fetch("/api/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actions: items }) });
  if (!r.ok) return { synced: 0 };
  const res: { results: { client_uuid: string; ok: boolean }[] } = await r.json();
  const d = await db();
  for (const x of res.results) await d.delete("q", x.client_uuid); // rejected ones are recorded server-side as sync_conflicts
  window.dispatchEvent(new CustomEvent("mt-queue-synced", { detail: res.results }));
  return { synced: res.results.length };
}
