import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { dashboardCounts } from "@/lib/services/items";
import { listLoans } from "@/lib/services/loans";
import { withUser } from "@/lib/db";
import { PageHeader, Section, Badge, ItemLink, Empty } from "@/components/ui";
import { fmtDateTime, fmtDate } from "@/lib/format";

export const metadata = { title: "Home" };

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
  }));
  const overdue = open.filter((l) => l.status === "Overdue");
  const legacy = open.filter((l) => l.legacy);
  const tiles: [string, number, string][] = [
    ["Out now", n.out_now, "/items?view=out_now"],
    ["Overdue", n.overdue, "/items?view=overdue"],
    ["In repair", n.in_repair, "/items?view=in_repair"],
    ["Lost", n.lost, "/items?view=lost"],
    ["Missing", n.missing, "/items?view=missing"],
    ["Bad condition", n.bad_condition, "/items?view=bad_condition"],
    ["Due for service", n.due_for_service, "/repairs#schedules"],
    ["To-buy awaiting approval", n.to_buy_awaiting, "/to-buy?status=To+buy"],
    ["To verify", n.to_verify, "/items?view=to_verify"],
    ["Missing photos", n.missing_photos, "/items?view=missing_photos"],
    ["Incomplete evidence", n.incomplete_evidence, "/loans?evidence=incomplete"],
    ["Active items", n.active, "/items"],
  ];
  return (
    <>
      <PageHeader title={`Hello, ${u.name.split(" ")[0]}`} sub={`${fmtDate(new Date())} · ${u.role}`} />
      <Link href="/scan" className="btn btn-primary mb-4 w-full text-xl" style={{ minHeight: 72 }} data-testid="big-scan">
        Scan an item
      </Link>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="dashboard-tiles">
        {tiles.map(([label, v, href]) => (
          <Link key={label} href={href} className="card p-4 no-underline" data-testid={`tile-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            <div className="text-3xl font-extrabold text-[var(--color-ink)]" data-testid="tile-value">
              {v}
            </div>
            <div className="muted font-semibold">{label}</div>
          </Link>
        ))}
      </div>
      {extra.conflicts > 0 && (
        <Section title="Offline sync conflicts">
          <p>
            <Link href="/loans?conflicts=1">{extra.conflicts} queued action(s) were rejected by the server and need a Manager.</Link>
          </p>
        </Section>
      )}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={`Overdue (${overdue.length})`}>
          {overdue.length === 0 ? (
            <Empty>Nothing overdue.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {overdue.slice(0, 10).map((l) => (
                <li key={l.id}>
                  <Link href={`/loans/${l.id}`} className="font-semibold">
                    {l.items}
                  </Link>{" "}
                  — {l.borrower_name}, due {fmtDateTime(l.due_at)}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Open loans (${open.length})`}>
          {open.length === 0 ? (
            <Empty>Nothing out.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {open.slice(0, 10).map((l) => (
                <li key={l.id}>
                  <Link href={`/loans/${l.id}`} className="font-semibold">
                    {l.items}
                  </Link>{" "}
                  — {l.borrower_name} <Badge v={l.status} />
                  {l.legacy && (
                    <span className="badge ml-1" style={{ color: "var(--color-warn)" }}>
                      legacy
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {legacy.length > 0 && (
            <p className="mt-3">
              <Link href="/loans?legacy=1">{legacy.length} legacy loan(s) from the sheet to confirm</Link>
            </p>
          )}
        </Section>
        <Section title="In repair">
          {extra.repairs.length === 0 ? (
            <Empty>No open repairs.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {extra.repairs.map((r) => (
                <li key={r.id}>
                  <ItemLink id={r.item_id} name={r.name} /> <Badge v={r.state} /> {r.expected_back && <span className="muted">back {fmtDate(r.expected_back)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Due for service">
          {extra.service.length === 0 ? (
            <Empty>Nothing due in the next 7 days.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {extra.service.map((s) => (
                <li key={s.id}>
                  {s.item_id ? <ItemLink id={s.item_id} name={s.label} /> : <b>All {s.label}</b>} — {fmtDate(s.next_due)}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="To-buy awaiting approval">
          {extra.toBuy.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {extra.toBuy.map((w) => (
                <li key={w.id}>
                  <Link href={`/to-buy/${w.id}`}>{w.item_description}</Link> <Badge v={w.priority} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
