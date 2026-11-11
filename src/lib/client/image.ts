/** FR-PHO-003 / NFR-017: compress on the device to ~1600 px longest side (JPEG), plus a 320 px thumbnail. */
async function toCanvasBlob(img: ImageBitmap | HTMLImageElement, max: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const sw = "width" in img ? img.width : 0,
    sh = "height" in img ? img.height : 0;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * scale),
    h = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", quality));
  return { blob, w, h };
}
export async function compressImage(file: File, max = 1600) {
  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });
  }
  const full = await toCanvasBlob(img, max, 0.82);
  const thumb = await toCanvasBlob(img, 320, 0.7);
  return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h };
}
