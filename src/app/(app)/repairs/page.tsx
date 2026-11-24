import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, ItemLink, Empty, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { addSchedule, doneSchedule } from "./actions";
import { fmtDate, fmtRs } from "@/lib/format";
import { lookups } from "@/lib/services/items";
export const metadata = { title: "Repairs" };
/** SCR-15: open and closed maintenance events, schedule due list */
export default async function Repairs() {
  const u = await requireUser(["Admin"]);
  const [d, lk] = await Promise.all([
    withUser(u.id, async (c) => ({
      open: (
        await c.query(`select m.*, i.name ${u.financeVisible ? ", mc.cost" : ""} from maintenance_events m join items i on i.id = m.item_id ${u.financeVisible ? "left join maintenance_costs mc on mc.event_id = m.id" : ""}
      where m.state not in ('Returned','Closed') order by m.expected_back nulls last, m.reported_at`)
      ).rows,
      closed: (
        await c.query(`select m.*, i.name ${u.financeVisible ? ", mc.cost" : ""} from maintenance_events m join items i on i.id = m.item_id ${u.financeVisible ? "left join maintenance_costs mc on mc.event_id = m.id" : ""}
      where m.state in ('Returned','Closed') order by coalesce(m.closed_at, m.reported_at) desc limit 100`)
      ).rows,
      sched: (await c.query(`select s.*, i.name from maintenance_schedules s left join items i on i.id = s.item_id where s.active order by s.next_due`)).rows,
    })),
    lookups(u),
  ]);
  const Row = ({ m }: { m: (typeof d.open)[number] }) => (
    <tr>
      <td>
        <ItemLink id={m.item_id} name={m.name} />
      </td>
      <td>
        <Link href={`/repairs/${m.id}`}>{m.type}</Link>
      </td>
      <td>
        <Badge v={m.state} />
      </td>
      <td>
        {m.issue_description}
        {m.year_to_verify && <Flag>year to verify</Flag>}
      </td>
      <td>{m.vendor ?? "—"}</td>
      <td>{fmtDate(m.expected_back)}</td>
      {u.financeVisible && <td>{fmtRs(m.cost)}</td>}
    </tr>
  );
  const head = (
    <thead>
      <tr>
        <th>Item</th>
        <th>Type</th>
        <th>State</th>
        <th>Issue</th>
        <th>Vendor</th>
        <th>Expected back</th>
        {u.financeVisible && <th>Cost</th>}
      </tr>
    </thead>
  );
  return (
    <>
      <PageHeader title="Repairs and servicing" phase={2} />
      <Section title={`Open (${d.open.length})`}>
        {d.open.length ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              {head}
              <tbody>
                {d.open.map((m) => (
                  <Row key={m.id} m={m} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No open repairs.</Empty>
        )}
      </Section>
      <Section title="Upkeep schedules" id="schedules">
        {d.sched.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>For</th>
                <th>Every</th>
                <th>Next due</th>
                <th>Last done</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.sched.map((s) => (
                <tr key={s.id}>
                  <td>{s.item_id ? <ItemLink id={s.item_id} name={s.name} /> : <b>All {s.item_type}</b>}</td>
                  <td>{s.interval_days} days</td>
                  <td>{fmtDate(s.next_due)}</td>
                  <td>{fmtDate(s.last_done)}</td>
                  <td>
                    {can.repairs(u) && (
                      <ActionForm action={doneSchedule}>
                        <input type="hidden" name="id" value={s.id} />
                        <Submit className="btn btn-sm btn-secondary">Done today</Submit>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No schedules. Sheldon Cooper proposes servicing cameras every 6 months (FR-CON-006).</Empty>
        )}
        {can.repairs(u) && (
          <ActionForm action={addSchedule} className="mt-3 grid gap-2 sm:grid-cols-5" resetOnSuccess>
            <input name="item_id" className="input" placeholder="Item ID (or choose a Type)" />
            <select name="item_type" className="input">
              <option value="">or Type…</option>
              {lk.types.map((t) => (
                <option key={t.name}>{t.name}</option>
              ))}
            </select>
            <input name="interval_days" type="number" min={1} defaultValue={180} className="input" required />
            <input name="next_due" type="date" className="input" required />
            <Submit>Add schedule</Submit>
          </ActionForm>
        )}
      </Section>
      <Section title="Closed (latest 100)">
        {d.closed.length ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              {head}
              <tbody>
                {d.closed.map((m) => (
                  <Row key={m.id} m={m} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>None.</Empty>
        )}
      </Section>
    </>
  );
}
