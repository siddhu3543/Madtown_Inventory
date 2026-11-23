import Link from "next/link";
import { Fragment } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Inbox, type LucideIcon } from "lucide-react";
import { fmtDate } from "@/lib/format";

/* ------------------------------------------------------------------------------------------
 * Design-system primitives. Server components only; client-side pieces live in their own files.
 * ------------------------------------------------------------------------------------------ */

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
  High: "var(--color-bad)",
  Medium: "var(--color-warn)",
  Low: "var(--color-muted)",
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
      <span className="badge badge-plain whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
        condition blank
      </span>
    );
  return (
    <span
      className="badge badge-plain whitespace-nowrap"
      style={{ color: v === "Bad condition" ? "var(--color-bad)" : v === "Good" || v === "New" ? "var(--color-ok)" : "var(--color-warn)" }}
    >
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

/** Standard page header: optional back link, h1, supporting text and an action cluster (hidden when printing). */
export function PageHeader({
  title,
  sub,
  actions,
  phase,
  back,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  phase?: 1 | 2 | 3;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="muted mb-2 inline-flex items-center gap-1 text-sm font-medium no-underline hover:text-[var(--color-ink)] no-print">
          <ChevronLeft size={16} aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">
            {title} {phase && <Phase n={phase} />}
          </h1>
          {sub && <div className="muted mt-1 text-[0.9375rem]">{sub}</div>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** A titled card. `flush` removes the padding for edge-to-edge tables. */
export function Section({
  title,
  children,
  actions,
  id,
  flush,
  description,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
  flush?: boolean;
  description?: React.ReactNode;
}) {
  return (
    <section className="card mb-5 overflow-x-auto" id={id}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="muted text-sm">{description}</p>}
        </div>
        {actions}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/** Empty state: icon, message and an optional call to action. */
export function Empty({ children, icon: Icon = Inbox, action }: { children: React.ReactNode; icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-wash)] text-[var(--color-muted)]">
        <Icon size={20} aria-hidden />
      </span>
      <p className="muted max-w-md text-[0.9375rem]">{children}</p>
      {action}
    </div>
  );
}

export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2.5 text-[0.9375rem]">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="muted font-medium">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
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
    <span className="badge !whitespace-normal" style={{ color: `var(--color-${tone})` }}>
      {children}
    </span>
  );
}

/** Inline message with an icon (replaces ad-hoc coloured paragraphs). */
export function Alert({
  tone = "info",
  children,
  title,
  className = "",
}: {
  tone?: "info" | "ok" | "warn" | "bad";
  children?: React.ReactNode;
  title?: string;
  className?: string;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? AlertCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`alert alert-${tone} ${className}`}>
      <Icon size={18} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "muted text-sm" : ""}>{children}</div>}
      </div>
    </div>
  );
}

/** Link tabs: the active tab is derived by the page from its own search params. */
export function Tabs({ tabs, active }: { tabs: { href: string; label: React.ReactNode; key: string }[]; active: string }) {
  return (
    <nav className="tabs mb-4 no-print" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="tab" aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

/** Initials avatar. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] font-semibold text-[var(--color-brand)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials || "?"}
    </span>
  );
}

type Tone = "brand" | "ok" | "warn" | "bad" | "muted";
const TONE: Record<Tone, string> = { brand: "var(--color-brand)", ok: "var(--color-ok)", warn: "var(--color-warn)", bad: "var(--color-bad)", muted: "var(--color-muted)" };

/** Clickable KPI tile. `alert` highlights it when the value is non-zero and the tone is a warning tone. */
export function StatCard({
  href,
  label,
  value,
  icon: Icon,
  tone = "brand",
  alert,
  testId,
  hint,
}: {
  href: string;
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: Tone;
  alert?: boolean;
  testId?: string;
  hint?: string;
}) {
  return (
    <Link href={href} className={`card kpi ${alert ? "kpi-alert" : ""}`} style={{ ["--kpi-c" as string]: TONE[tone] }} data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="kpi-icon">
          <Icon size={18} aria-hidden />
        </span>
        <ChevronRight size={16} aria-hidden className="text-[var(--color-line-strong)]" />
      </div>
      <div>
        <div className="kpi-value" data-testid="tile-value">
          {value}
        </div>
        <div className="muted mt-1.5 text-[0.875rem] font-medium">{label}</div>
        {hint && <div className="muted text-xs">{hint}</div>}
      </div>
    </Link>
  );
}

/** Simple prev/next pager driven by plain links (server-rendered). */
export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-2 no-print" aria-label="Pagination">
      <Link href={href(Math.max(1, page - 1))} aria-disabled={page <= 1} className={`btn btn-secondary btn-sm ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}>
        <ChevronLeft size={16} aria-hidden /> Previous
      </Link>
      <span className="muted text-sm">
        Page {page} of {pages}
      </span>
      <Link href={href(Math.min(pages, page + 1))} aria-disabled={page >= pages} className={`btn btn-secondary btn-sm ${page >= pages ? "pointer-events-none opacity-50" : ""}`}>
        Next <ChevronRight size={16} aria-hidden />
      </Link>
    </nav>
  );
}

/** Form block: title + help text on the left, fields on the right (stacks on mobile). */
export function FormSection({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-4 border-t border-[var(--color-line)] py-6 first:border-t-0 first:pt-0 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="muted mt-1 text-sm">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}
