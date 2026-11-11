import { api } from "@/lib/api";
import { uploadPhotoBytes } from "@/lib/services/photos";
type Ctx = { params: Promise<{ id: string }> };
export const PUT = api<Ctx>(async (u, req, { params }) => {
  const { id } = await params;
  const fd = await req.formData();
  const file = fd.get("file") as File | null;
  const thumb = fd.get("thumb") as File | null;
  if (!file) return { error: "file missing" };
  return uploadPhotoBytes(u, id, Buffer.from(await file.arrayBuffer()), thumb ? Buffer.from(await thumb.arrayBuffer()) : null, file.type || "image/jpeg");
});
