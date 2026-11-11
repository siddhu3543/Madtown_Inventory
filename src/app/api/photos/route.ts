import { api } from "@/lib/api";
import { createPhotoIntent, uploadPhotoBytes } from "@/lib/services/photos";

/** POST JSON {kind, item_id, ...} -> {id} (intent), or multipart with file(s) -> intent + upload in one request. */
export const POST = api(async (u, req) => {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file") as File | null;
    const thumb = fd.get("thumb") as File | null;
    const id = await createPhotoIntent(u, {
      kind: String(fd.get("kind")),
      item_id: (fd.get("item_id") as string) || null,
      order_id: (fd.get("order_id") as string) || null,
      mime: file?.type,
    });
    if (file) await uploadPhotoBytes(u, id, Buffer.from(await file.arrayBuffer()), thumb ? Buffer.from(await thumb.arrayBuffer()) : null, file.type || "image/jpeg");
    return { id };
  }
  const b = await req.json();
  return { id: await createPhotoIntent(u, b) };
});
