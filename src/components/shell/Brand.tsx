import Link from "next/link";

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-[var(--color-ink)] no-underline hover:no-underline" aria-label="Madtown Inventory home">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand)] text-[0.95rem] font-bold text-[var(--color-brand-ink)]">M</span>
      {!compact && (
        <span className="rail-hide leading-tight">
          <span className="block text-[0.95rem] font-semibold tracking-tight">Madtown</span>
          <span className="block text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--color-muted)]">Inventory</span>
        </span>
      )}
    </Link>
  );
}
