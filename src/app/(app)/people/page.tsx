import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { addPerson } from "./actions";

export const metadata = { title: "People" };

/** SCR-10 people list */
export default async function People() {
  const u = await requireUser();
  const rows = await withUser(
    u.id,
    async (c) =>
      (
        await c.query(`
    select p.*, us.role, (select count(*) from loans l where l.borrower_person_id = p.id and l.status in ('Open','Overdue'))::int as open_loans,
           (select count(*) from loans l where l.borrower_person_id = p.id and l.status = 'Overdue')::int as overdue
      from people p left join users us on us.person_id = p.id where not p.is_madtown order by p.active desc, p.name`)
      ).rows,
  );
  return (
    <>
      <PageHeader title="People" sub="Everyone who can hold or own items, with or without a login" />
      <div className="card overflow-x-auto">
        <table className="tbl" data-testid="people-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Login</th>
              <th>Open loans</th>
              <th>Overdue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/people/${p.id}`} className="font-semibold">
                    {p.name}
                  </Link>
                  {!p.active && " (inactive)"}
                </td>
                <td>
                  {p.person_type}
                  {p.person_type_to_verify && <Flag>to verify</Flag>}
                </td>
                <td>{p.role ?? "No login (borrower)"}</td>
                <td>{p.open_loans}</td>
                <td>{p.overdue ? <Flag tone="bad">{p.overdue}</Flag> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can.people(u) && (
        <div className="card mt-4 p-4">
          <h2 className="mb-2 text-lg font-bold">Add a borrower without login</h2>
          <ActionForm action={addPerson} className="grid gap-2 sm:grid-cols-5" resetOnSuccess>
            <input name="name" className="input" placeholder="Name" required />
            <select name="person_type" className="input">
              {["Freelancer", "Staff", "Vendor", "Client contact"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input name="email" type="email" className="input" placeholder="Email (optional)" />
            <input name="phone" className="input" placeholder="Phone (optional)" />
            <Submit>Add</Submit>
          </ActionForm>
        </div>
      )}
    </>
  );
}
