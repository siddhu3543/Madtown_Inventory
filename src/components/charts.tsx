/** Dependency-free, server-rendered charts. They only draw numbers the caller read from the database. */

export type Seg = { label: string; value: number; color: string; href?: string };

/** Segmented bar with a legend that carries label + count (never colour alone). */
export function StackedBar({ segments, label }: { segments: Seg[]; label: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-line)]"
        role="img"
        aria-label={`${label}: ${shown.map((s) => `${s.label} ${s.value}`).join(", ")}`}
      >
        {shown.map((s) => (
          <div
            key={s.label}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            className="first:rounded-l-full last:rounded-r-full [&:not(:last-child)]:border-r-2 [&:not(:last-child)]:border-[var(--color-paper)]"
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-[0.9375rem]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="font-semibold tabular-nums">
              {s.value}
              {total > 0 && <span className="muted ml-1.5 text-xs font-normal">{Math.round((s.value / total) * 100)}%</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bar rows: filled part = `value` of `max`. */
export function BarRows({
  rows,
  max,
  color = "var(--color-brand)",
  unit,
}: {
  rows: { label: string; value: number; total?: number; href?: string }[];
  max?: number;
  color?: string;
  unit?: string;
}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.total ?? r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        return (
          <li key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[0.9375rem]">
              <span className="truncate font-medium">{r.label}</span>
              <span className="tabular-nums">
                <b>{r.value}</b>
                {r.total !== undefined && <span className="muted"> / {r.total}</span>}
                {unit && <span className="muted text-xs"> {unit}</span>}
              </span>
            </div>
            <div
              className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-line)]"
              role="img"
              aria-label={`${r.label}: ${r.value}${r.total !== undefined ? ` of ${r.total}` : ""}`}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.min(100, (r.total !== undefined ? r.value / Math.max(1, r.total) : r.value / m) * 100)}%`, background: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
