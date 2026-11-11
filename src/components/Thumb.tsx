/* eslint-disable @next/next/no-img-element */
export function Thumb({ id, alt, size = 56, full }: { id: string | null | undefined; alt: string; size?: number; full?: boolean }) {
  if (!id)
    return (
      <div
        aria-label="no photo"
        className="flex items-center justify-center rounded-md border border-dashed border-[var(--color-line)] text-xs muted"
        style={{ width: size, height: size }}
      >
        no photo
      </div>
    );
  return (
    <img
      src={`/api/photos/${id}/file${full ? "?size=full" : ""}`}
      alt={alt}
      loading="lazy"
      className="rounded-md object-cover bg-[var(--color-wash)]"
      style={{ width: size, height: size }}
    />
  );
}
