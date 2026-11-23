import Link from "next/link";
import {
  AlertTriangle,
  AlarmClock,
  ArrowLeftRight,
  Camera,
  CalendarClock,
  CircleHelp,
  ClipboardCheck,
  Package,
  Plus,
  ScanLine,
  SearchX,
  ShoppingCart,
  ShieldCheck,
  Wrench,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { dashboardCounts } from "@/lib/services/items";
import { listLoans } from "@/lib/services/loans";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, ItemLink, Empty, StatCard } from "@/components/ui";
import { StackedBar, BarRows } from "@/components/charts";
import { fmtDateTime, fmtDate, istParts } from "@/lib/format";

export const metadata = { title: "Dashboard" };

const STATUS_COLORS: Record<string, string> = {
  Available: "var(--color-ok)",
  "Checked out": "var(--color-brand)",
  Reserved: "#7c8fe8",
  "In repair": "var(--color-warn)",
  Missing: "var(--color-bad)",
  Lost: "color-mix(in srgb, var(--color-bad) 65%, var(--color-ink))",
};

function greeting() {
  const h = istParts().hh;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** SCR-02 / FR-RPT-001: counts use the same flags as the item list filters (AC-RPT-01). */
export default async function Dashboard() {
  const u = await requireUser();
  const [n, open] = await Promise.all([dashboardCounts(u), listLoans(u, { status: "open" })]);
  const extra = await withUser(u.id, async (c) => ({
    repairs: (
      await c.query(
        `select m.id, m.item_id, i.name, m.state, m.expected_back from maintenance_events m join items i on i.id = m.item_id where m.state not in ('Returned','Closed') order by m.reported_at desc limit 8`,
      )
    ).rows,
    service: (
      await c.query(
        `select s.*, coalesce(i.name, s.item_type) as label from maintenance_schedules s left join items i on i.id = s.item_id where s.active and s.next_due <= current_date + 7 order by s.next_due limit 8`,
      )
    ).rows,
    toBuy: (
      await c.query(
        `select id, item_description, priority from wishlist_items where status = 'To buy' order by case priority when 'High' then 0 when 'Medium' then 1 else 2 end limit 8`,
      )
    ).rows,
    conflicts: u.role === "Owner" || u.role === "Manager" ? (await c.query(`select count(*)::int n from sync_conflicts where resolved_at is null`)).rows[0].n : 0,
    // read-only aggregates over the same views the item list uses
    byStatus: (await c.query(`select display_status as label, count(*)::int as n from items_v where is_active group by 1 order by 2 desc`)).rows as { label: string; n: number }[],
    byType: (
      await c.query(
        `select type as label, count(*)::int as total, (count(*) filter (where display_status = 'Available'))::int as available from items_v where is_active group by 1 order by 2 desc limit 6`,
      )
    ).rows as { label: string; total: number; available: number }[],
    procurement: (await c.query(`select status as label, count(*)::int as n from wishlist_items group by 1`)).rows as { label: string; n: number }[],
    recent: (
      await c.query(
        `select l.id, l.status, l.checked_out_at, l.checked_in_at, p.name as borrower,
                (select string_agg(ll.item_id, ', ' order by ll.item_id) from loan_lines ll where ll.loan_id = l.id) as ids
           from loans l join people p on p.id = l.borrower_person_id
          where l.checked_out_at is not null or l.checked_in_at is not null
          order by greatest(l.checked_out_at, l.checked_in_at) desc nulls last limit 6`,
      )
    ).rows as { id: string; status: string; checked_out_at: string | null; checked_in_at: string | null; borrower: string; ids: string | null }[],
  }));
  const overdue = open.filter((l) => l.status === "Overdue");
  const legacy = open.filter((l) => l.legacy);

  // testId keeps the original tile-<label> ids stable (AC-RPT-01 e2e)
  const kpis: { label: string; testId: string; v: number; href: string; icon: LucideIcon; tone: "brand" | "ok" | "warn" | "bad" | "muted"; alert?: boolean }[] = [
    { label: "Active items", testId: "tile-active-items", v: n.active, href: "/items", icon: Package, tone: "brand" },
    { label: "Items checked out", testId: "tile-out-now", v: n.out_now, href: "/items?view=out_now", icon: ArrowLeftRight, tone: "brand" },
    { label: "Overdue items", testId: "tile-overdue", v: n.overdue, href: "/items?view=overdue", icon: AlarmClock, tone: "bad", alert: n.overdue > 0 },
    { label: "Items in repair", testId: "tile-in-repair", v: n.in_repair, href: "/items?view=in_repair", icon: Wrench, tone: "warn" },
    { label: "Lost items", testId: "tile-lost", v: n.lost, href: "/items?view=lost", icon: SearchX, tone: "bad", alert: n.lost > 0 },
    { label: "Missing items", testId: "tile-missing", v: n.missing, href: "/items?view=missing", icon: CircleHelp, tone: "bad", alert: n.missing > 0 },
    { label: "Due for service", testId: "tile-due-for-service", v: n.due_for_service, href: "/repairs#schedules", icon: CalendarClock, tone: "warn", alert: n.due_for_service > 0 },
    { label: "To-buy awaiting approval", testId: "tile-to-buy-awaiting-approval", v: n.to_buy_awaiting, href: "/to-buy?status=To+buy", icon: ShoppingCart, tone: "warn" },
  ];
  const quality: [string, string, number, string][] = [
    ["Bad condition", "tile-bad-condition", n.bad_condition, "/items?view=bad_condition"],
    ["To verify", "tile-to-verify", n.to_verify, "/items?view=to_verify"],
    ["Missing photos", "tile-missing-photos", n.missing_photos, "/items?view=missing_photos"],
    ["Incomplete evidence", "tile-incomplete-evidence", n.incomplete_evidence, "/loans?evidence=incomplete"],
  ];

  const attention: { icon: LucideIcon; tone: string; title: string; text: string; n: number; href: string }[] = [
    { icon: AlarmClock, tone: "bad", title: "Overdue equipment", text: "Loans past their due date", n: overdue.length, href: "/items?view=overdue" },
    { icon: Wrench, tone: "warn", title: "Open repairs", text: "Reported, sent for repair or awaiting return", n: extra.repairs.length, href: "/repairs" },
    { icon: CalendarClock, tone: "warn", title: "Service coming due", text: "Scheduled maintenance inside the reminder window", n: n.due_for_service, href: "/repairs#schedules" },
    { icon: ShieldCheck, tone: "warn", title: "Needs verification", text: "Items flagged To verify (stock, model or details)", n: n.to_verify, href: "/items?view=to_verify" },
    { icon: Camera, tone: "muted", title: "Missing photographs", text: "Active items with no photo yet", n: n.missing_photos, href: "/items?view=missing_photos" },
    {
      icon: ShoppingCart,
      tone: "warn",
      title: "Purchases awaiting approval",
      text: "To-buy lines ready for an Owner decision",
      n: n.to_buy_awaiting,
      href: "/to-buy?status=To+buy",
    },
    {
      icon: ClipboardCheck,
      tone: "warn",
      title: "Incomplete loan evidence",
      text: "Check-out/in photos still pending upload",
      n: n.incomplete_evidence,
      href: "/loans?evidence=incomplete",
    },
    {
      icon: RefreshCw,
      tone: "bad",
      title: "Offline sync conflicts",
      text: "Queued actions the server rejected — a Manager must resolve",
      n: extra.conflicts,
      href: "/loans?conflicts=1",
    },
  ].filter((a) => a.n > 0);

  const statusSegs = extra.byStatus.map((s) => ({ label: s.label, value: s.n, color: STATUS_COLORS[s.label] ?? "var(--color-muted)" }));
  const stages = ["To research", "To buy", "Approved", "Ordered", "Received"];
  const proc = stages.map((s) => ({ label: s, value: extra.procurement.find((p) => p.label === s)?.n ?? 0 }));

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${u.name.split(" ")[0]}`}
        sub={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{fmtDate(new Date())}</span>
            <span aria-hidden>·</span>
            <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--color-brand)]">{u.role}</span>
          </span>
        }
        actions={
          <>
            <Link href="/scan" className="btn btn-primary" data-testid="big-scan">
              <ScanLine size={18} aria-hidden /> Scan an item
            </Link>
            {can.editItems(u) && (
              <Link href="/items/new" className="btn btn-secondary">
                <Plus size={18} aria-hidden /> Add item
              </Link>
            )}
            {can.proposeBuy(u) && (
              <Link href="/to-buy/new" className="btn btn-secondary">
                <ShoppingCart size={18} aria-hidden /> Propose purchase
              </Link>
            )}
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="dashboard-tiles">
        {kpis.map((k) => (
          <StatCard key={k.testId} href={k.href} label={k.label} value={k.v} icon={k.icon} tone={k.tone} alert={k.alert} testId={k.testId} />
        ))}
      </div>
      <div className="mb-6 flex flex-wrap gap-2" aria-label="Data quality">
        {quality.map(([label, testId, v, href]) => (
          <Link key={testId} href={href} className="chip" data-testid={testId}>
            <span className="muted font-medium">{label}</span>
            <b className="tabular-nums" data-testid="tile-value">
              {v}
            </b>
          </Link>
        ))}
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <section className="card lg:col-span-2" aria-labelledby="attn">
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
            <h2 id="attn" className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle size={18} className="text-[var(--color-warn)]" aria-hidden /> Attention required
            </h2>
            {attention.length > 0 && (
              <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--color-warn)]">{attention.length} to review</span>
            )}
          </div>
          {attention.length === 0 ? (
            <Empty icon={ShieldCheck}>All clear — nothing needs attention right now.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {attention.map((a) => (
                <li key={a.title}>
                  <Link href={a.href} className="flex items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-[var(--color-wash)] hover:no-underline">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{ color: `var(--color-${a.tone})`, background: `color-mix(in srgb, var(--color-${a.tone}) 11%, transparent)` }}
                    >
                      <a.icon size={18} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-[var(--color-ink)]">{a.title}</span>
                      <span className="muted block truncate text-sm">{a.text}</span>
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">{a.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Section title="Inventory status" description="Active items by current status">
          {statusSegs.length === 0 ? <Empty icon={Package}>No active items yet.</Empty> : <StackedBar segments={statusSegs} label="Inventory status" />}
        </Section>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3 [&>*]:min-w-0 [&>section]:mb-0">
        <Section title="Equipment availability" description="Available vs total, by type">
          {extra.byType.length === 0 ? (
            <Empty icon={Package}>No equipment recorded.</Empty>
          ) : (
            <BarRows rows={extra.byType.map((t) => ({ label: t.label, value: t.available, total: t.total }))} color="var(--color-ok)" />
          )}
        </Section>
        <Section title="Loans & maintenance" description="Outstanding right now">
          <dl className="grid grid-cols-2 gap-3">
            {[
              ["Open loans", open.length, "/loans", "var(--color-ink)"],
              ["Overdue", overdue.length, "/items?view=overdue", overdue.length ? "var(--color-bad)" : "var(--color-ink)"],
              ["Legacy to confirm", legacy.length, "/loans?legacy=1", legacy.length ? "var(--color-warn)" : "var(--color-ink)"],
              ["Open repairs", extra.repairs.length, "/repairs", extra.repairs.length ? "var(--color-warn)" : "var(--color-ink)"],
            ].map(([label, v, href, c]) => (
              <Link
                key={label as string}
                href={href as string}
                className="rounded-lg border border-[var(--color-line)] p-3 no-underline hover:border-[var(--color-line-strong)] hover:bg-[var(--color-wash)] hover:no-underline"
              >
                <dt className="muted text-sm">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: c as string }}>
                  {v}
                </dd>
              </Link>
            ))}
          </dl>
        </Section>
        <Section
          title="Procurement"
          description="Wishlist lines by stage"
          actions={
            <Link href="/to-buy" className="text-sm font-semibold">
              View all
            </Link>
          }
        >
          <BarRows rows={proc} color="var(--color-brand)" max={Math.max(1, ...proc.map((p) => p.value))} />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0 [&>section]:mb-0">
        <Section title={`Overdue (${overdue.length})`}>
          {overdue.length === 0 ? (
            <Empty icon={ShieldCheck}>Nothing overdue.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {overdue.slice(0, 10).map((l) => (
                <li key={l.id}>
                  <Link href={`/loans/${l.id}`} className="font-semibold">
                    {l.items}
                  </Link>{" "}
                  <span className="muted">
                    — {l.borrower_name}, due {fmtDateTime(l.due_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title={`Open loans (${open.length})`}
          actions={
            <Link href="/loans" className="text-sm font-semibold">
              View all
            </Link>
          }
        >
          {open.length === 0 ? (
            <Empty icon={ArrowLeftRight}>Nothing out.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {open.slice(0, 8).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/loans/${l.id}`} className="font-semibold">
                    {l.items}
                  </Link>
                  <span className="muted">— {l.borrower_name}</span> <Badge v={l.status} />
                  {l.legacy && (
                    <span className="badge" style={{ color: "var(--color-warn)" }}>
                      legacy
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {legacy.length > 0 && (
            <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-sm">
              <Link href="/loans?legacy=1">{legacy.length} legacy loan(s) from the sheet to confirm</Link>
            </p>
          )}
        </Section>
        <Section title="In repair">
          {extra.repairs.length === 0 ? (
            <Empty icon={Wrench}>No open repairs.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {extra.repairs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ItemLink id={r.item_id} name={r.name} /> <Badge v={r.state} /> {r.expected_back && <span className="muted text-sm">back {fmtDate(r.expected_back)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Due for service">
          {extra.service.length === 0 ? (
            <Empty icon={CalendarClock}>Nothing due in the next 7 days.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {extra.service.map((s) => (
                <li key={s.id}>
                  {s.item_id ? <ItemLink id={s.item_id} name={s.label} /> : <b>All {s.label}</b>} <span className="muted">— {fmtDate(s.next_due)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title="To-buy awaiting approval"
          actions={
            <Link href="/to-buy" className="text-sm font-semibold">
              View all
            </Link>
          }
        >
          {extra.toBuy.length === 0 ? (
            <Empty icon={ShoppingCart}>Nothing waiting for a decision.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {extra.toBuy.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/to-buy/${w.id}`}>{w.item_description}</Link> <Badge v={w.priority} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recent activity" description="Latest check-outs and check-ins">
          {extra.recent.length === 0 ? (
            <Empty icon={ArrowLeftRight}>No loan activity yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {extra.recent.map((r) => {
                const returned = !!r.checked_in_at;
                return (
                  <li key={r.id} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: returned ? "var(--color-ok)" : "var(--color-brand)" }} aria-hidden />
                    <span className="min-w-0 text-[0.9375rem]">
                      <Link href={`/loans/${r.id}`} className="font-semibold">
                        {returned ? "Checked in" : "Checked out"}
                      </Link>{" "}
                      {r.ids} <span className="muted">— {r.borrower}</span>
                      <span className="muted block text-xs">{fmtDateTime(returned ? r.checked_in_at : r.checked_out_at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
