import "server-only";
import { createHash } from "node:crypto";
import { withUser, callWorkflow } from "../db";
import { storage, storageFor } from "../adapters/storage";
import type { CurrentUser } from "../auth";
import { AppError } from "../errors";

const KINDS = ["Stock", "Latest", "Check-out", "Check-in", "Damage", "Invoice", "Audit"] as const;
export type PhotoKind = (typeof KINDS)[number];

/** Step 1 (ADR-11): create the photo record as `pending` so the check-out/in rule can count it immediately. */
export async function createPhotoIntent(
  u: CurrentUser,
  p: {
    item_id?: string | null;
    kind: string;
    loan_id?: string | null;
    incident_id?: string | null;
    maintenance_event_id?: string | null;
    order_id?: string | null;
    mime?: string;
    width?: number;
    height?: number;
    bytes?: number;
    note?: string;
  },
) {
  if (!KINDS.includes(p.kind as PhotoKind)) throw new AppError("BAD_KIND", "Unknown photo kind");
  return withUser(u.id, async (c) => {
    const r = await c.query(
      `insert into photos(item_id, kind, provider, loan_id, incident_id, maintenance_event_id, order_id, mime_type, width, height, bytes, note, taken_by, upload_state)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, auth.uid(), 'pending') returning id`,
      [
        p.item_id ?? null,
        p.kind,
        storage().name,
        p.loan_id ?? null,
        p.incident_id ?? null,
        p.maintenance_event_id ?? null,
        p.order_id ?? null,
        p.mime ?? "image/jpeg",
        p.width ?? null,
        p.height ?? null,
        p.bytes ?? null,
        p.note ?? null,
      ],
    );
    return r.rows[0].id as string;
  });
}

/** Step 2: upload bytes in the background. Failure leaves the record `failed` with a visible "evidence incomplete" state (A4). */
export async function uploadPhotoBytes(u: CurrentUser, id: string, full: Buffer, thumb: Buffer | null, mime = "image/jpeg") {
  const ph = await withUser(u.id, async (c) => (await c.query("select id, item_id, order_id, kind, upload_state, taken_by from photos where id = $1", [id])).rows[0]);
  if (!ph) throw new AppError("NOT_FOUND", "Photo not found", 404);
  if (ph.upload_state === "uploaded") return { id, state: "uploaded" };
  if (full.length > 8 * 1024 * 1024) throw new AppError("TOO_LARGE", "Photo is larger than 8 MB; it should have been compressed on the device");
  const folder = ph.item_id ?? (ph.order_id ? `order-${ph.order_id}` : "unassigned");
  const ext = mime === "image/webp" ? "webp" : mime === "application/pdf" ? "pdf" : "jpg";
  try {
    const a = storage();
    const f = await a.put(folder, `${ph.kind.toLowerCase()}-${id}.${ext}`, full, mime);
    const t = thumb ? await a.put(folder, `thumb-${id}.jpg`, thumb, "image/jpeg") : null;
    const sum = createHash("sha256").update(full).digest("hex");
    await withUser(u.id, (c) =>
      c.query(
        `update photos set provider = $2, provider_file_id = $3, provider_folder_id = $4, thumbnail_ref = $5, checksum_sha256 = $6, mime_type = $7,
              bytes = $8, upload_state = 'uploaded', uploaded_at = now(), upload_error = null, upload_attempts = upload_attempts + 1 where id = $1`,
        [id, a.name, f.fileId, f.folderId, t?.fileId ?? null, sum, mime, full.length],
      ),
    );
    return { id, state: "uploaded" };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 500) ?? "upload failed";
    await withUser(u.id, (c) => c.query("update photos set upload_state = 'failed', upload_error = $2, upload_attempts = upload_attempts + 1 where id = $1", [id, msg])).catch(
      () => {},
    );
    throw new AppError("UPLOAD_FAILED", "Upload failed; it will retry automatically. " + msg, 502);
  }
}

/** Serve through the app so RLS decides (Invoice photos only for finance viewers). */
export async function readPhoto(u: CurrentUser, id: string, size: "thumb" | "full") {
  const ph = await withUser(u.id, async (c) => (await c.query("select * from photos where id = $1", [id])).rows[0]);
  if (!ph) throw new AppError("NOT_FOUND", "Photo not found", 404);
  if (ph.upload_state === "legacy" || !ph.provider_file_id) return { redirect: ph.original_url as string | null, photo: ph };
  const fileId = size === "thumb" && ph.thumbnail_ref ? ph.thumbnail_ref : ph.provider_file_id;
  const f = await storageFor(ph.provider).get(fileId);
  return { bytes: f.bytes, mime: size === "thumb" && ph.thumbnail_ref ? "image/jpeg" : (ph.mime_type ?? f.mime), photo: ph };
}

export const promoteLatest = (u: CurrentUser, photoId: string) => withUser(u.id, (c) => callWorkflow(c, "promote_latest_photo", { photo_id: photoId }));
export const setStockImage = (u: CurrentUser, photoId: string) => withUser(u.id, (c) => callWorkflow(c, "set_stock_image", { photo_id: photoId }));

export async function folderFiles(u: CurrentUser, photoId: string) {
  const ph = await withUser(u.id, async (c) => (await c.query("select * from photos where id = $1", [photoId])).rows[0]);
  if (!ph?.provider_folder_id) return [];
  const a = storage();
  return a.listFolder ? a.listFolder(ph.provider_folder_id) : [];
}
