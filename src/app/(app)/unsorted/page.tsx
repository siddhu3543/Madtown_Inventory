import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/services/items";
import { PageHeader, Badge, ItemLink, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { updateRow, convert } from "./actions";
export const metadata = { title: "Unsorted items" };
/** SCR-21: rows from Not yet sorted with question, who can answer, status, convert to item */
export default async function Unsorted() {
  const u = await requireUser();
  if (!can.unsorted(u)) return <p>Managers only.</p>;
  const [rows, lk] = await Promise.all([
    withUser(u.id, async (c) => (await c.query("select * from unsorted_items order by (status = 'Converted'), sheet_row nulls last")).rows),
    lookups(u),
  ]);
  return (
    <>
      <PageHeader title="Unsorted items" sub="From the Not yet sorted tab. Converted to an item only after a Manager fills the required fields." />
      <ul className="flex flex-col gap-3" data-testid="unsorted">
        {rows.map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-lg">{r.item}</b> <Badge v={r.status} />{" "}
              {r.duplicate_of_item_id && !r.duplicate_cleared && (
                <Flag tone="bad">
                  possible duplicate of <ItemLink id={r.duplicate_of_item_id} />
                </Flag>
              )}
              {r.converted_item_ids.map((x: string) => (
                <ItemLink key={x} id={x} />
              ))}
            </div>
            <p className="mt-1">
              <b>What we know:</b> {r.known}
            </p>
            <p>
              <b>Question:</b> {r.question}
            </p>
            <p>
              <b>Who can answer:</b> {r.who_can_answer}
            </p>
            {can.editItems(u) && r.status !== "Converted" && (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <ActionForm action={updateRow} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <select name="status" className="input w-auto" defaultValue={r.status}>
                    {["Undecided", "Missing: to locate", "To clarify", "To list", "To verify", "Discarded"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <input name="notes" className="input w-56" defaultValue={r.notes ?? ""} placeholder="Answer / notes" />
                  {r.duplicate_of_item_id && (
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="duplicate_cleared" defaultChecked={r.duplicate_cleared} /> not a duplicate
                    </label>
                  )}
                  <Submit className="btn btn-secondary">Save</Submit>
                </ActionForm>
                <details>
                  <summary className="cursor-pointer font-semibold">Convert to item</summary>
                  <ActionForm action={convert} className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="name" className="input" placeholder="Item name" defaultValue={r.item} required />
                    <select name="type" className="input">
                      {lk.types.map((t) => (
                        <option key={t.name}>{t.name}</option>
                      ))}
                    </select>
                    <input name="model_number" className="input" placeholder="Model" />
                    <select name="quantity_mode" className="input">
                      <option>Single</option>
                      <option>Counted</option>
                    </select>
                    <input name="stock" type="number" min={1} defaultValue={1} className="input" />
                    <select name="condition" className="input">
                      {lk.conditions.map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="missing" defaultChecked={r.status === "Missing: to locate"} /> Create with status Missing
                    </label>
                    <Submit>Convert</Submit>
                  </ActionForm>
                </details>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
