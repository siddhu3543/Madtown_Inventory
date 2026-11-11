import Link from "next/link";
import { Fragment } from "react";
import { fmtDate } from "@/lib/format";

const STATUS_COLOR: Record<string, string> = {
  Available: "var(--color-ok)",
  "Checked out": "var(--color-brand)",
  Reserved: "var(--color-brand)",
  "In repair": "var(--color-warn)",
  Missing: "var(--color-bad)",
  Lost: "var(--color-bad)",
  Retired: "var(--color-muted)",
  Open: "var(--color-brand)",
  Overdue: "var(--color-bad)",
  Returned: "var(--color-ok)",
  Approved: "var(--color-ok)",
  Rejected: "var(--color-muted)",
  Ordered: "var(--color-brand)",
  Received: "var(--color-ok)",
  "To buy": "var(--color-warn)",
  "To research": "var(--color-muted)",
  Reported: "var(--color-warn)",
  "Sent for repair": "var(--color-warn)",
  Closed: "var(--color-muted)",
  Resolved: "var(--color-ok)",
  "Pending write-off": "var(--color-warn)",
  Placed: "var(--color-brand)",
  Delivered: "var(--color-ok)",
  "Partially delivered": "var(--color-warn)",
  Cancelled: "var(--color-muted)",
  Found: "var(--color-ok)",
  "Not found": "var(--color-bad)",
  "Wrong location": "var(--color-warn)",
  "Condition changed": "var(--color-warn)",
};
export function Badge({ v, title }: { v: string | null | undefined; title?: string }) {
  if (!v)
    return (
      <span className="badge" style={{ color: "var(--color-muted)" }}>
        blank
      </span>
    );
  return (
    <span className="badge" title={title} style={{ color: STATUS_COLOR[v] ?? "var(--color-ink)" }} data-testid="badge">
      {v}
    </span>
  );
}
export function Cond({ v }: { v: string | null | undefined }) {
  if (!v)
    return (
      <span className="badge" style={{ color: "var(--color-muted)" }}>
        condition blank
      </span>
    );
  return (
    <span className="badge" style={{ color: v === "Bad condition" ? "var(--color-bad)" : v === "Good" || v === "New" ? "var(--color-ok)" : "var(--color-warn)" }}>
      {v}
    </span>
  );
}
export function Phase({ n }: { n: 1 | 2 | 3 }) {
  return (
    <span className="phase" title={`Phase ${n} feature (section 12)`}>
      P{n}
    </span>
  );
}
export function PageHeader({ title, sub, actions, phase }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; phase?: 1 | 2 | 3 }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">
          {title} {phase && <Phase n={phase} />}
        </h1>
        {sub && <div className="muted mt-1">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
}
export function Section({ title, children, actions, id }: { title: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <section className="card mb-4 overflow-x-auto p-4" id={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted py-2">{children}</p>;
}
export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="muted font-semibold">{k}</dt>
          <dd>{v ?? "—"}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
export function ItemLink({ id, name }: { id: string; name?: string | null }) {
  return (
    <Link href={`/items/${encodeURIComponent(id)}`} className="font-semibold">
      {id}
      {name ? ` ${name}` : ""}
    </Link>
  );
}
export function DateText({ d }: { d: string | Date | null | undefined }) {
  return <>{fmtDate(d)}</>;
}
export function Flag({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "bad" | "ok" }) {
  return (
    <span className="badge" style={{ color: `var(--color-${tone})` }}>
      {children}
    </span>
  );
}
