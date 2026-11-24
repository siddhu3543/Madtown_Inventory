import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/services/items";
import { PageHeader, Section, Badge, ItemLink, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { start } from "./actions";
import { fmtDateTime, fmtDate } from "@/lib/format";
export const metadata = { title: "Walkthrough" };
/** SCR-19 + FR-AUD-008 not audited in 90 days */
export default async function Walkthroughs() {
  const u = await requireUser(["Admin"]);
  const [d, lk] = await Promise.all([
    withUser(u.id, async (c) => ({
      audits: (
        await c.query(
          "select a.*, p.name starter, (select count(*) from audit_lines l where l.audit_id = a.id)::int scanned from audits a left join users us on us.id = a.started_by left join people p on p.id = us.person_id order by a.started_at desc limit 50",
        )
      ).rows,
      stale: (
        await c.query(
          "select id, name, last_audited_at from items_v where is_active and (last_audited_at is null or last_audited_at < now() - make_interval(days => coalesce((app.setting('audit_stale_days') #>> '{}')::int, 90))) order by last_audited_at nulls first, id",
        )
      ).rows,
    })),
    lookups(u),
  ]);
  return (
    <>
      <PageHeader title="Walkthrough audits" phase={2} />
      {can.walkthrough(u) && (
        <Section title="Start a walkthrough">
          <ActionForm action={start} className="grid gap-2 sm:grid-cols-4">
            <select name="scope_kind" className="input" data-testid="scope-kind">
              <option>All</option>
              <option>Location</option>
              <option>Type</option>
              <option>Holder</option>
            </select>
            <input name="scope_value" className="input" list="scopes" placeholder="Location / Type / Holder (leave blank for All)" data-testid="scope-value" />
            <datalist id="scopes">
              {[...lk.locations.map((l) => l.name), ...lk.types.map((t) => t.name), ...lk.holders.map((h) => h.name)].map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
            <input name="note" className="input" placeholder="Note" />
            <Submit>Start</Submit>
          </ActionForm>
        </Section>
      )}
      <Section title="Sessions">
        {d.audits.length ? (
          <ul>
            {d.audits.map((a) => (
              <li key={a.id}>
                <Link href={`/walkthrough/${a.id}`} className="font-semibold">
                  {a.scope_kind}
                  {a.scope_value ? `: ${a.scope_value}` : ""}
                </Link>{" "}
                · {fmtDateTime(a.started_at)} by {a.starter} · {a.scanned} scanned <Badge v={a.status} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No walkthroughs yet.</Empty>
        )}
      </Section>
      <Section title={`Not audited in 90 days (${d.stale.length})`}>
        <ul className="columns-1 sm:columns-2">
          {d.stale.slice(0, 200).map((i) => (
            <li key={i.id}>
              <ItemLink id={i.id} name={i.name} /> <span className="muted text-sm">{i.last_audited_at ? fmtDate(i.last_audited_at) : "never"}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
