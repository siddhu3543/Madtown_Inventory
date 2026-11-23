/* eslint-disable @next/next/no-img-element */
import { ImageOff } from "lucide-react";

export function Thumb({ id, alt, size = 56, full }: { id: string | null | undefined; alt: string; size?: number; full?: boolean }) {
  if (!id)
    return (
      <div
        aria-label="no photo"
        role="img"
        className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--color-line-strong)] bg-[var(--color-wash)] text-[var(--color-muted)]"
        style={{ width: size, height: size }}
      >
        <ImageOff size={Math.round(size * 0.36)} aria-hidden />
      </div>
    );
  return (
    <img
      src={`/api/photos/${id}/file${full ? "?size=full" : ""}`}
      alt={alt}
      loading="lazy"
      className="shrink-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-wash)] object-cover"
      style={{ width: size, height: size }}
    />
  );
}
