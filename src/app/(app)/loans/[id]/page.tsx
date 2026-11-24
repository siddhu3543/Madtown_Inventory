import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getLoan } from "@/lib/services/loans";
import { lookups } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, Cond, KV, ItemLink, Flag, Empty } from "@/components/ui";
import { Thumb } from "@/components/Thumb";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PhotoCapture } from "@/components/PhotoCapture";
import { CheckinDeclarations } from "@/components/CheckinDeclarations";
import { Req } from "@/components/CheckoutForm";
import { fmtDateTime, toIstInput } from "@/lib/format";
import * as A from "./actions";

export const metadata = { title: "Loan" };

export default async function LoanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const d = await getLoan(u, id);
  if (!d) notFound();
  const lk = await lookups(u);
  const { loan, lines } = d;
  const open = loan.status === "Open" || loan.status === "Overdue";
  const mine = loan.borrower_person_id === u.personId;
  const canIn = can.checkin(u) && (mine || can.checkoutOthers(u));
  const rules = await withUser(u.id, async (c) => (await c.query("select name, checkin_photo_required from item_types")).rows);
  const photoReq = (t: string) => rules.find((r) => r.name === t)?.checkin_photo_required;
  const outstanding = lines.filter((l) => l.outstanding > 0);
  const pending = d.photos.filter((p) => p.upload_state !== "uploaded").length;
  return (
    <>
      {sp.new && (
        <p className="mb-2 rounded-md border-2 border-[var(--color-ok)] p-3 font-semibold text-[var(--color-ok)]" data-testid="checked-out">
          Checked out. Status is now Checked out.{sp.w ? ` Notes: ${sp.w}` : ""}
        </p>
      )}
      {sp.done && (
        <p className="mb-2 rounded-md border-2 border-[var(--color-ok)] p-3 font-semibold text-[var(--color-ok)]" data-testid="checked-in">
          Check-in saved. Loan status: {loan.status}.
        </p>
      )}
      {sp.transferred && (
        <p className="mb-2 rounded-md border-2 border-[var(--color-ok)] p-3 font-semibold text-[var(--color-ok)]">
          Transferred. This is the new loan in the same chain of custody.
        </p>
      )}
      <PageHeader
        title={`Loan: ${loan.kit_name ? `${loan.kit_id} ${loan.kit_name}` : lines.map((l) => l.item_id).join(", ")}`}
        sub={
          <>
            <Badge v={loan.status} /> {loan.legacy && <Flag>legacy loan from sheet — to verify</Flag>}{" "}
            {pending > 0 && <Flag tone="bad">evidence incomplete ({pending} photo upload(s) pending)</Flag>}
          </>
        }
      />
      {sp.worse && open === false && (
        <Section title="Condition is worse than at check-out">
          <p className="mb-2">Open a repair or incident linked to this loan (FR-CHK-005).</p>
          {lines.map((l) => (
            <div key={l.id} className="mb-2 flex flex-wrap gap-2" data-testid="one-tap">
              <span className="font-semibold">{l.item_id}</span>
              {can.repairs(u) && (
                <ActionForm action={A.oneTapRepair}>
                  <input type="hidden" name="kind" value="repair" />
                  <input type="hidden" name="item_id" value={l.item_id} />
                  <input type="hidden" name="loan_id" value={loan.id} />
                  <Submit>Open repair</Submit>
                </ActionForm>
              )}
              <ActionForm action={A.oneTapRepair}>
                <input type="hidden" name="kind" value="incident" />
                <input type="hidden" name="item_id" value={l.item_id} />
                <input type="hidden" name="loan_id" value={loan.id} />
                <Submit className="btn btn-secondary">Record damage incident</Submit>
              </ActionForm>
            </div>
          ))}
        </Section>
      )}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Details">
          <KV
            rows={[
              [
                "Borrower",
                <Link key="b" href={`/people/${loan.borrower_person_id}`} data-testid="borrower-name">
                  {loan.borrower_name}
                </Link>,
              ],
              ["Purpose / project", loan.purpose_or_project],
              ["Checked out", loan.checked_out_at ? `${fmtDateTime(loan.checked_out_at)}${loan.out_by_name ? ` by ${loan.out_by_name}` : ""}` : "unknown (legacy)"],
              [
                "Due",
                <span key="d" data-testid="due-at">
                  {loan.due_at ? fmtDateTime(loan.due_at) : "no due date (legacy, to confirm)"}
                </span>,
              ],
              [
                "Checked in",
                loan.checked_in_at
                  ? `${fmtDateTime(loan.checked_in_at)}${loan.in_by_name ? ` by ${loan.in_by_name}` : ""}${loan.checkin_backdated ? ` (back-dated: ${loan.checkin_backdate_reason})` : ""}`
                  : "—",
              ],
              [
                "Condition",
                <span key="c">
                  <Cond v={loan.condition_out} /> → {loan.condition_in ? <Cond v={loan.condition_in} /> : "—"}
                </span>,
              ],
              [
                "Reminders sent",
                <span key="r" data-testid="reminder-count">
                  {loan.reminder_count}
                </span>,
              ],
              ["Extensions", String(loan.extension_count)],
              ["Override", loan.override_reason],
              [
                "Notes",
                <span key="n" className="whitespace-pre-wrap">
                  {loan.notes ?? "—"}
                </span>,
              ],
            ]}
          />
        </Section>
        <Section title="Items">
          <ul className="flex flex-col gap-1">
            {lines.map((l) => (
              <li key={l.id}>
                <ItemLink id={l.item_id} name={l.name} /> {l.quantity > 1 && `×${l.quantity}`} · returned {l.qty_returned}
                {l.qty_lost ? ` · lost ${l.qty_lost}` : ""}
                {l.qty_transferred ? ` · transferred ${l.qty_transferred}` : ""}
                {l.outstanding > 0 && open && <Flag>{l.outstanding} out</Flag>} {loan.kit_id && (l.kit_required ? "(required)" : "(optional)")}
              </li>
            ))}
          </ul>
          {(d.repairs.length > 0 || d.incidents.length > 0) && (
            <div className="mt-3">
              <b>Linked:</b>
              {d.repairs.map((r) => (
                <div key={r.id}>
                  <Link href={`/repairs/${r.id}`}>
                    {r.type} on {r.item_id}
                  </Link>{" "}
                  <Badge v={r.state} />
                </div>
              ))}
              {d.incidents.map((i) => (
                <div key={i.id}>
                  {i.type} on {i.item_id} <Badge v={i.status} />
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Chain of custody">
        <ol className="flex flex-col gap-1" data-testid="chain">
          {d.chain.map((c) => (
            <li key={c.id} className={c.id === loan.id ? "font-bold" : ""}>
              <Link href={`/loans/${c.id}`}>{c.borrower}</Link> · {c.checked_out_at ? fmtDateTime(c.checked_out_at) : "unknown"} →{" "}
              {c.checked_in_at ? fmtDateTime(c.checked_in_at) : "now"} <Badge v={c.status} />
            </li>
          ))}
        </ol>
        <h3 className="mt-3 font-semibold">Events</h3>
        <ul className="text-sm">
          {d.events.map((e) => (
            <li key={e.id}>
              {fmtDateTime(e.at)} · <b>{e.event}</b> {e.item_id} {e.quantity ? `×${e.quantity}` : ""} {e.person_name ? `· ${e.person_name}` : ""}{" "}
              {e.by_name ? `(by ${e.by_name})` : ""} {e.note ? `— ${e.note}` : ""}
            </li>
          ))}
        </ul>
      </Section>

      {d.photos.length > 0 && (
        <Section title="Evidence photos">
          <div className="flex flex-wrap gap-2">
            {d.photos.map((p) => (
              <div key={p.id} className="text-xs">
                <Thumb id={p.id} alt={p.kind} size={96} />
                <div>
                  {p.kind} {p.upload_state !== "uploaded" && <Flag tone="bad">{p.upload_state}</Flag>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {open && canIn && (
        <Section title="Check in" id="checkin">
          <ActionForm action={A.doCheckin} className="flex flex-col gap-4">
            <input type="hidden" name="loan_id" value={loan.id} />
            <table className="tbl" data-testid="checkin-lines">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Out</th>
                  <th>Returned</th>
                  <th>Lost</th>
                  {loan.kit_id && <th>Record missing part</th>}
                </tr>
              </thead>
              <tbody>
                {outstanding.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <input type="hidden" name="line_id" value={l.id} />
                      <input type="hidden" name={`item_${l.id}`} value={l.item_id} />
                      {l.item_id} {l.name}
                      {loan.kit_id ? (l.kit_required ? " (required)" : " (optional)") : ""}
                    </td>
                    <td>{l.outstanding}</td>
                    <td>
                      {l.quantity_mode === "Counted" ? (
                        <input
                          name={`ret_${l.id}`}
                          type="number"
                          min={0}
                          max={l.outstanding}
                          defaultValue={l.outstanding}
                          className="input w-24"
                          data-testid={`ret-${l.item_id}`}
                        />
                      ) : (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name={`ret_${l.id}`} value="1" defaultChecked data-testid={`ret-${l.item_id}`} /> back
                        </label>
                      )}
                    </td>
                    <td>
                      {can.override(u) || l.quantity_mode === "Counted" ? (
                        <input name={`lost_${l.id}`} type="number" min={0} max={l.outstanding} defaultValue={0} className="input w-20" />
                      ) : (
                        "—"
                      )}
                    </td>
                    {loan.kit_id && (
                      <td>
                        <input type="checkbox" name={`mp_${l.id}`} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {loan.kit_id && (
              <>
                <input type="hidden" name="parent_for_mp" value="" />
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" name="partial" data-testid="partial" /> Partial check-in (leave the rest open or record missing parts)
                </label>
              </>
            )}
            {!loan.kit_id && lines.some((l) => l.quantity_mode === "Counted") && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="partial" /> Partial check-in
              </label>
            )}
            <label className="field">
              <span>
                Condition at check-in <Req />
                {loan.condition_out && <span className="muted font-normal"> — at check-out: {loan.condition_out}</span>}
              </span>
              <select name="condition_in" className="input" defaultValue="" required data-testid="condition-in">
                <option value="" disabled>
                  Check the item and choose…
                </option>
                {lk.conditions.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            {outstanding.map((l) => (
              <PhotoCapture key={l.id} itemId={l.item_id} kind="Check-in" required={!!photoReq(l.type)} label={`Check-in photo of ${l.item_id}`} />
            ))}
            <CheckinDeclarations lines={lines.map((l) => ({ item_id: l.item_id, name: l.name }))} />
            <label className="field">
              <span>
                If anything is lost: where it was last seen <span className="muted font-normal">(required when a Lost quantity is entered)</span>
              </span>
              <input name="lost_place" className="input" data-testid="lost-place" />
            </label>
            {can.override(u) && (
              <details>
                <summary className="cursor-pointer font-semibold">Back-date this check-in (Admin)</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="field">
                    <span>Returned at (IST)</span>
                    <input name="backdated_at" type="datetime-local" className="input" />
                  </label>
                  <label className="field">
                    <span>Reason</span>
                    <input name="backdate_reason" className="input" />
                  </label>
                </div>
              </details>
            )}
            <Submit className="btn btn-primary w-full text-lg">Check in</Submit>
          </ActionForm>
        </Section>
      )}

      {open && (
        <div className="grid gap-4 lg:grid-cols-3">
          {(can.checkoutOthers(u) || mine) && can.checkin(u) && (
            <Section title="Extend due date">
              <ActionForm action={A.doExtend} className="flex flex-col gap-2">
                <input type="hidden" name="loan_id" value={loan.id} />
                <label className="field">
                  <span>New due (IST)</span>
                  <input
                    name="new_due_at"
                    type="datetime-local"
                    className="input"
                    required
                    defaultValue={toIstInput(new Date(Math.max(Date.now(), new Date(loan.due_at ?? Date.now()).getTime()) + 2 * 86400000))}
                  />
                </label>
                <label className="field">
                  <span>Reason</span>
                  <input name="reason" className="input" required />
                </label>
                <Submit className="btn btn-secondary">Extend</Submit>
              </ActionForm>
            </Section>
          )}
          {(can.checkoutOthers(u) || mine) && can.checkin(u) && (
            <Section title="Transfer to someone else">
              <ActionForm action={A.doTransfer} className="flex flex-col gap-2">
                <input type="hidden" name="loan_id" value={loan.id} />
                <label className="field">
                  <span>To</span>
                  <select name="to_person_id" className="input" required data-testid="transfer-to">
                    {lk.people
                      .filter((p) => !p.is_madtown && p.active && p.id !== loan.borrower_person_id && (can.checkoutOthers(u) || p.has_login))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Due (IST, optional)</span>
                  <input name="due_at" type="datetime-local" className="input" />
                </label>
                <label className="field">
                  <span>Reason</span>
                  <input name="reason" className="input" required />
                </label>
                <Submit className="btn btn-secondary">Transfer</Submit>
              </ActionForm>
            </Section>
          )}
          {can.override(u) && (
            <Section title="Mark as lost">
              <ActionForm action={A.doMarkLost} className="flex flex-col gap-2">
                <input type="hidden" name="loan_id" value={loan.id} />
                <label className="field">
                  <span>What happened</span>
                  <input name="reason" className="input" required />
                </label>
                <label className="field">
                  <span>Last seen place</span>
                  <input name="last_seen_place" className="input" />
                </label>
                <Submit className="btn btn-danger" confirm="Mark all outstanding items on this loan as lost?">
                  Mark lost
                </Submit>
              </ActionForm>
            </Section>
          )}
        </div>
      )}

      {d.extensions.length > 0 && (
        <Section title="Extensions">
          <ul>
            {d.extensions.map((x) => (
              <li key={x.id}>
                {fmtDateTime(x.old_due_at)} → {fmtDateTime(x.new_due_at)} · {x.reason} ({x.by_name})
              </li>
            ))}
          </ul>
        </Section>
      )}
      {d.reminders.length > 0 && (
        <Section title="Reminder history">
          <ul className="text-sm">
            {d.reminders.map((r, i) => (
              <li key={i}>
                {fmtDateTime(r.created_at)} · {r.event_code} · {r.status} · to {r.intended_recipients.join(", ")}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!open && d.reminders.length === 0 && <Empty> </Empty>}
    </>
  );
}
