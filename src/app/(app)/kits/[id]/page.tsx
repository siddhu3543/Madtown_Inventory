import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, ItemLink, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { addKitItem, updateKitItem } from "../actions";
import { fmtDateTime } from "@/lib/format";
export const metadata = { title: "Kit" };
/** SCR-14 kit detail: contents with required flags */
export default async function Kit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ scanned?: string }> }) {
  const u = await requireUser();
  const id = decodeURIComponent((await params).id).toUpperCase();
  const sp = await searchParams;
  const d = await withUser(u.id, async (c) => ({
    kit: (await c.query("select * from kits where id = $1", [id])).rows[0],
    parts: (
      await c.query(
        "select ki.*, v.name, v.display_status, v.available_qty, v.quantity_mode, v.flag_missing_parts from kit_items ki join items_v v on v.id = ki.item_id where ki.kit_id = $1 order by ki.sort, ki.item_id",
        [id],
      )
    ).rows,
    loan: (await c.query("select l.*, p.name borrower from loans l join people p on p.id = l.borrower_person_id where l.kit_id = $1 and l.status in ('Open','Overdue')", [id]))
      .rows[0],
    res: (
      await c.query(
        "select r.*, p.name person from reservations r join people p on p.id = r.person_id where r.kit_id = $1 and r.status = 'Active' and r.ends_at > now() order by starts_at",
        [id],
      )
    ).rows,
  }));
  if (!d.kit) notFound();
  const ready = d.parts.length > 0 && d.parts.every((p) => p.display_status === "Available" || (p.quantity_mode === "Counted" && p.available_qty >= p.quantity));
  return (
    <>
      {sp.scanned && <p className="mb-2 font-semibold text-[var(--color-ok)]">Scanned {id}</p>}
      <PageHeader
        title={`${d.kit.id} · ${d.kit.name}`}
        phase={2}
        sub={d.kit.description}
        actions={
          <>
            {can.labels(u) && (
              <Link href={`/labels?kits=${id}`} className="btn btn-secondary">
                Print kit label
              </Link>
            )}
          </>
        }
      />
      {d.loan ? (
        <p className="card mb-4 p-4">
          Checked out to <b>{d.loan.borrower}</b>, due {fmtDateTime(d.loan.due_at)} ·{" "}
          <Link href={`/loans/${d.loan.id}`} className="btn btn-primary ml-2" data-testid="kit-checkin">
            Check in kit
          </Link>
        </p>
      ) : (
        can.checkoutSelf(u) && (
          <Link href={`/kits/${id}/checkout`} className={`btn btn-primary mb-4 w-full ${ready ? "" : "pointer-events-none opacity-50"}`} data-testid="kit-checkout">
            {ready ? "Check out kit" : "Kit not complete or a part is unavailable"}
          </Link>
        )
      )}
      <Section title="Contents">
        {d.parts.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Part</th>
                <th>Qty</th>
                <th>Required</th>
                <th>Status</th>
                {can.editItems(u) && <th />}
              </tr>
            </thead>
            <tbody>
              {d.parts.map((p) => (
                <tr key={p.item_id}>
                  <td>
                    <ItemLink id={p.item_id} name={p.name} />
                    {p.flag_missing_parts && " (has missing parts)"}
                  </td>
                  <td>{p.quantity}</td>
                  <td>{p.required ? "Required" : "Optional"}</td>
                  <td>
                    <Badge v={p.display_status} />
                  </td>
                  {can.editItems(u) && (
                    <td className="flex gap-1">
                      <ActionForm action={updateKitItem}>
                        <input type="hidden" name="kit_id" value={id} />
                        <input type="hidden" name="item_id" value={p.item_id} />
                        <Submit className="btn btn-sm btn-secondary" name="op" value="toggle">
                          {p.required ? "Make optional" : "Make required"}
                        </Submit>
                      </ActionForm>
                      <ActionForm action={updateKitItem}>
                        <input type="hidden" name="kit_id" value={id} />
                        <input type="hidden" name="item_id" value={p.item_id} />
                        <Submit className="btn btn-sm btn-secondary" name="op" value="remove">
                          Remove
                        </Submit>
                      </ActionForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No parts yet.</Empty>
        )}
        {can.editItems(u) && (
          <ActionForm action={addKitItem} className="mt-3 grid gap-2 sm:grid-cols-4" resetOnSuccess>
            <input type="hidden" name="kit_id" value={id} />
            <input name="item_ids" className="input sm:col-span-2" placeholder="Item IDs, e.g. 182 183 184" required data-testid="kit-add-ids" />
            <input name="quantity" type="number" min={1} defaultValue={1} className="input" />
            <label className="flex items-center gap-2">
              <input type="checkbox" name="required" defaultChecked /> Required
            </label>
            <Submit>Add parts</Submit>
          </ActionForm>
        )}
      </Section>
      {d.res.length > 0 && (
        <Section title="Reservations">
          <ul>
            {d.res.map((r) => (
              <li key={r.id}>
                {r.shoot}: {r.person} {fmtDateTime(r.starts_at)} → {fmtDateTime(r.ends_at)}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
