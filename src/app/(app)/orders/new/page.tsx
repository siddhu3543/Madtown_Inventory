import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createOrder } from "../actions";
export const metadata = { title: "Record order" };
export default async function NewOrder({ searchParams }: { searchParams: Promise<{ wishlist?: string }> }) {
  const u = await requireUser(["Owner", "Manager"]);
  const sp = await searchParams;
  const approved = await withUser(u.id, async (c) => (await c.query("select id, item_description from wishlist_items where status = 'Approved' order by approved_at desc")).rows);
  const pre = approved.find((w) => w.id === sp.wishlist);
  return (
    <>
      <PageHeader title="Record an incoming order" phase={2} />
      <div className="card p-4">
        <ActionForm action={createOrder} className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Vendor</span>
            <input name="vendor" className="input" required />
          </label>
          <label className="field">
            <span>Order number</span>
            <input name="order_ref" className="input" required />
          </label>
          <label className="field">
            <span>Order date</span>
            <input name="order_date" type="date" className="input" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </label>
          <label className="field">
            <span>Expected delivery</span>
            <input name="expected_delivery" type="date" className="input" />
          </label>
          {u.financeVisible && (
            <label className="field">
              <span>Amount (Rs)</span>
              <input name="amount" type="number" step="0.01" className="input" />
            </label>
          )}
          <label className="field">
            <span>Notes</span>
            <input name="notes" className="input" />
          </label>
          <fieldset className="card grid gap-2 p-3 sm:col-span-2">
            <legend className="font-semibold">Lines</legend>
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_5rem]">
                <input name="line_description" className="input" placeholder="What was ordered" required={i === 0} defaultValue={i === 0 ? (pre?.item_description ?? "") : ""} />
                <select name="line_wishlist" className="input" defaultValue={i === 0 ? (pre?.id ?? "") : ""}>
                  <option value="">To-buy line (optional)</option>
                  {approved.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.item_description}
                    </option>
                  ))}
                </select>
                <input name="line_qty" type="number" min={1} defaultValue={1} className="input" />
              </div>
            ))}
            <p className="muted text-sm">Attach the GST invoice or order PDF from the order page.</p>
          </fieldset>
          <Submit>Save order</Submit>
        </ActionForm>
      </div>
    </>
  );
}
