import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, KV, ItemLink, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PhotoCapture } from "@/components/PhotoCapture";
import { advance } from "../actions";
import { fmtDate, fmtDateTime, fmtRs } from "@/lib/format";
export const metadata = { title: "Repair" };
const STATES = ["Reported", "Sent for repair", "In repair", "Returned", "Closed"];
export default async function Repair({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const d = await withUser(u.id, async (c) => ({
    m: (
      await c.query(
        "select m.*, i.name, p.name reporter from maintenance_events m join items i on i.id = m.item_id left join people p on p.id = m.reported_by_person_id where m.id = $1",
        [id],
      )
    ).rows[0],
    h: (
      await c.query(
        "select h.*, p.name by_name from maintenance_state_history h left join users u on u.id = h.by_user left join people p on p.id = u.person_id where event_id = $1 order by at",
        [id],
      )
    ).rows,
    cost: u.financeVisible ? (await c.query("select * from maintenance_costs where event_id = $1", [id])).rows[0] : null,
    cond: (await c.query("select name from conditions where enabled order by rank desc")).rows,
  }));
  if (!d.m) notFound();
  const next = STATES.slice(STATES.indexOf(d.m.state) + 1);
  return (
    <>
      <PageHeader
        title={`${d.m.type}: ${d.m.item_id} ${d.m.name}`}
        phase={2}
        sub={
          <>
            <Badge v={d.m.state} /> {d.m.legacy && <Flag>imported from sheet</Flag>} {d.m.to_verify && <Flag>to verify</Flag>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Details">
          <KV
            rows={[
              ["Item", <ItemLink key="i" id={d.m.item_id} name={d.m.name} />],
              ["Issue", d.m.issue_description],
              ["Cause", d.m.cause],
              ["Reported", `${fmtDateTime(d.m.reported_at)}${d.m.reporter ? ` by ${d.m.reporter}` : ""}`],
              ["Event date", d.m.event_date_text ?? fmtDate(d.m.event_date)],
              ["Vendor", d.m.vendor],
              ["Sent", fmtDate(d.m.sent_at)],
              ["Expected back", fmtDate(d.m.expected_back)],
              ["Returned", fmtDate(d.m.returned_at)],
              ["Outcome", d.m.outcome],
              ...(u.financeVisible ? [["Cost", fmtRs(d.cost?.cost)] as [string, React.ReactNode]] : []),
              [
                "Linked loan",
                d.m.linked_loan_id ? (
                  <Link key="l" href={`/loans/${d.m.linked_loan_id}`}>
                    loan
                  </Link>
                ) : (
                  "—"
                ),
              ],
            ]}
          />
        </Section>
        <Section title="History (AC-CON-02)">
          <ol data-testid="repair-history">
            {d.h.map((h) => (
              <li key={h.id}>
                {fmtDateTime(h.at)} · <b>{h.to_state}</b> {h.by_name ? `by ${h.by_name}` : ""} {h.note ? `— ${h.note}` : ""}
              </li>
            ))}
          </ol>
        </Section>
      </div>
      {can.repairs(u) && d.m.state !== "Closed" && (
        <Section title="Update">
          <ActionForm action={advance} className="grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="event_id" value={d.m.id} />
            <label className="field">
              <span>Move to</span>
              <select name="to_state" className="input" data-testid="to-state">
                <option value="">(keep {d.m.state})</option>
                {next.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Vendor</span>
              <input name="vendor" className="input" defaultValue={d.m.vendor ?? ""} />
            </label>
            <label className="field">
              <span>Sent on</span>
              <input name="sent_at" type="date" className="input" />
            </label>
            <label className="field">
              <span>Expected back</span>
              <input name="expected_back" type="date" className="input" />
            </label>
            <label className="field">
              <span>Returned on</span>
              <input name="returned_at" type="date" className="input" />
            </label>
            <label className="field">
              <span>Condition after</span>
              <select name="condition_after" className="input">
                <option value="">(unchanged)</option>
                {d.cond.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cause</span>
              <input name="cause" className="input" defaultValue={d.m.cause ?? ""} />
            </label>
            <label className="field">
              <span>Outcome</span>
              <input name="outcome" className="input" />
            </label>
            {u.financeVisible && (
              <label className="field">
                <span>Cost (Rs)</span>
                <input name="cost" type="number" step="0.01" className="input" defaultValue={d.cost?.cost ?? ""} />
              </label>
            )}
            <label className="field sm:col-span-2">
              <span>Note</span>
              <input name="note" className="input" />
            </label>
            <Submit>Save</Submit>
          </ActionForm>
          {u.financeVisible && (
            <div className="mt-3">
              <PhotoCapture itemId={d.m.item_id} kind="Invoice" label="Repair invoice (photo or scan)" link={{ maintenance_event_id: d.m.id }} />
            </div>
          )}
        </Section>
      )}
    </>
  );
}
