import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { personProfile } from "@/lib/services/loans";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, ItemLink, Empty, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { updatePerson } from "../actions";

export const metadata = { title: "Borrower profile" };

/** SCR-10 / FR-LOAN-006: open loans, overdue loans, loan history, items returned damaged, contact details */
export default async function Person({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser(["Admin"]);
  const d = await personProfile(u, (await params).id);
  if (!d) notFound();
  const open = d.loans.filter((l) => l.status === "Open" || l.status === "Overdue");
  const overdue = d.loans.filter((l) => l.status === "Overdue");
  const past = d.loans.filter((l) => !(l.status === "Open" || l.status === "Overdue"));
  const L = ({ rows, testid }: { rows: typeof d.loans; testid: string }) =>
    rows.length ? (
      <ul className="flex flex-col gap-1" data-testid={testid}>
        {rows.map((l) => (
          <li key={l.id}>
            <Link href={`/loans/${l.id}`} className="font-semibold">
              {l.items}
            </Link>{" "}
            · {l.checked_out_at ? fmtDate(l.checked_out_at) : "date unknown"}
            {l.due_at ? ` · due ${fmtDateTime(l.due_at)}` : ""}
            {l.checked_in_at ? ` · returned ${fmtDate(l.checked_in_at)}` : ""} <Badge v={l.status} /> {l.legacy && <Flag>legacy</Flag>}
          </li>
        ))}
      </ul>
    ) : (
      <Empty>None.</Empty>
    );
  return (
    <>
      <PageHeader
        title={d.person.name}
        sub={
          <>
            {d.person.person_type}
            {d.person.person_type_to_verify ? " (to verify)" : ""} · {d.person.role ? `Login: ${d.person.role}` : "Borrower without login"}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={`Open loans (${open.length})`}>
          <L rows={open} testid="open-loans" />
        </Section>
        <Section title={`Overdue (${overdue.length})`}>
          <L rows={overdue} testid="overdue-loans" />
        </Section>
        <Section title="Currently holding (no loan / counted units)">
          {d.holdings.length ? (
            <ul data-testid="holdings">
              {d.holdings.map((h, i) => (
                <li key={i}>
                  <ItemLink id={h.item_id} name={h.name} /> {h.mode === "Counted" ? `×${h.quantity}` : ""} <Badge v={h.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing.</Empty>
          )}
          {d.detached.length > 0 && (
            <>
              <h3 className="mt-2 font-semibold">Detached accessories</h3>
              <ul>
                {d.detached.map((x) => (
                  <li key={x.id}>
                    {x.description} of <ItemLink id={x.item_id} name={x.name} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
        <Section title="Items returned damaged">
          {d.damaged.length ? (
            <ul data-testid="damaged">
              {d.damaged.map((x, i) => (
                <li key={i}>
                  <ItemLink id={x.item_id} name={x.name} /> · {x.condition_out ?? ""} → {x.condition_in} · {fmtDate(x.checked_in_at)} <Link href={`/loans/${x.loan_id}`}>loan</Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>None.</Empty>
          )}
        </Section>
        {d.responsible.length > 0 && (
          <Section title="Incidents where responsible">
            <ul>
              {d.responsible.map((i) => (
                <li key={i.id}>
                  <ItemLink id={i.item_id} name={i.name} /> · {i.type} ×{i.quantity} · {i.description}
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title={`Loan history (${past.length})`}>
          <L rows={past} testid="past-loans" />
        </Section>
      </div>
      {can.people(u) && !d.person.is_madtown && (
        <Section title="Details and contact (Admins only)">
          <ActionForm action={updatePerson} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="id" value={d.person.id} />
            <label className="field">
              <span>Name</span>
              <input name="name" className="input" defaultValue={d.person.name} required />
            </label>
            <label className="field">
              <span>Type</span>
              <select name="person_type" className="input" defaultValue={d.person.person_type}>
                {["Staff", "Freelancer", "Vendor", "Client contact"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Email (for reminders)</span>
              <input name="email" type="email" className="input" defaultValue={d.contact?.email ?? ""} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input name="phone" className="input" defaultValue={d.contact?.phone ?? ""} />
            </label>
            <label className="field sm:col-span-2">
              <span>Notes</span>
              <input name="notes" className="input" defaultValue={d.person.notes ?? ""} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={d.person.active} /> Active (inactive people cannot borrow)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="type_to_verify" defaultChecked={d.person.person_type_to_verify} /> Type to verify
            </label>
            <Submit>Save</Submit>
          </ActionForm>
        </Section>
      )}
    </>
  );
}
