import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/services/items";
import { PageHeader, Section, Badge, KV, ItemLink } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PhotoCapture } from "@/components/PhotoCapture";
import { cancelOrder, receive } from "../actions";
import { fmtDate, fmtRs } from "@/lib/format";
export const metadata = { title: "Order" };
export default async function Order({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ received?: string }> }) {
  const u = await requireUser(["Owner", "Manager", "Read-only"]);
  const { id } = await params;
  const sp = await searchParams;
  const d = await withUser(u.id, async (c) => ({
    o: (
      await c.query(
        `select o.* ${u.financeVisible ? ", f.amount" : ""} from orders o ${u.financeVisible ? "left join order_financials f on f.order_id = o.id" : ""} where o.id = $1`,
        [id],
      )
    ).rows[0],
    lines: (
      await c.query(
        `select ol.*, w.item_description wl, (select coalesce(json_agg(json_build_object('id', i.id, 'name', i.name)), '[]') from order_line_items x join items i on i.id = x.item_id where x.order_line_id = ol.id) items
       from order_lines ol left join wishlist_items w on w.id = ol.wishlist_id where ol.order_id = $1`,
        [id],
      )
    ).rows,
    invoices: (await c.query("select id from photos where order_id = $1 and kind = 'Invoice'", [id])).rows,
  }));
  if (!d.o) notFound();
  const lk = await lookups(u);
  const open = d.lines.filter((l) => l.received_qty < l.quantity);
  return (
    <>
      {sp.received && (
        <div className="card mb-3 border-[var(--color-ok)] p-4" data-testid="received">
          <b>Received.</b> New items:{" "}
          {sp.received.split(",").map((x) => (
            <span key={x} className="mr-2">
              <ItemLink id={x} />
            </span>
          ))}
          <p className="mt-2">
            Next: add a stock photo on each item and <Link href={`/labels?ids=${sp.received}`}>print QR labels</Link>.
          </p>
        </div>
      )}
      <PageHeader title={`${d.o.vendor} ${d.o.order_ref}`} phase={2} sub={<Badge v={d.o.status} />} />
      <Section title="Order">
        <KV
          rows={[
            ["Order date", fmtDate(d.o.order_date)],
            ["Expected delivery", fmtDate(d.o.expected_delivery)],
            ["Delivered", fmtDate(d.o.delivered_at)],
            ...(u.financeVisible ? [["Amount", fmtRs(d.o.amount)] as [string, React.ReactNode]] : []),
            ["Cancelled", d.o.cancelled_reason],
            ["Notes", d.o.notes],
            [
              "Invoice",
              d.invoices.length
                ? d.invoices.map((p) => (
                    <a key={p.id} href={`/api/photos/${p.id}/file?size=full`} className="mr-2">
                      invoice
                    </a>
                  ))
                : "—",
            ],
          ]}
        />
        {u.financeVisible && can.orders(u) && (
          <div className="mt-3">
            <PhotoCapture itemId={null} kind="Invoice" label="Attach GST invoice / order PDF photo" link={{ order_id: d.o.id }} />
          </div>
        )}
      </Section>
      <Section title="Lines">
        {d.lines.map((l) => (
          <div key={l.id} className="mb-2">
            {l.description} ×{l.quantity} — received {l.received_qty}
            {l.wl ? ` · to-buy: ${l.wl}` : ""}
            {l.items.length > 0 && (
              <div className="text-sm">
                Created:{" "}
                {l.items.map((i: { id: string; name: string }) => (
                  <span key={i.id} className="mr-2">
                    <ItemLink id={i.id} />
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </Section>
      {can.orders(u) && d.o.status !== "Cancelled" && open.length > 0 && (
        <Section title="Receive and create items (FR-BUY-007)">
          <ActionForm action={receive} className="flex flex-col gap-3">
            <input type="hidden" name="order_id" value={id} />
            {open.map((l) => (
              <fieldset key={l.id} className="card grid gap-2 p-3 sm:grid-cols-3">
                <legend className="font-semibold">{l.description}</legend>
                <input type="hidden" name="line_id" value={l.id} />
                <label className="field">
                  <span>Quantity received</span>
                  <input name={`qty_${l.id}`} type="number" min={0} max={l.quantity - l.received_qty} defaultValue={l.quantity - l.received_qty} className="input" />
                </label>
                <label className="field">
                  <span>Item name</span>
                  <input name={`name_${l.id}`} className="input" defaultValue={l.description} required />
                </label>
                <label className="field">
                  <span>Type</span>
                  <select name={`type_${l.id}`} className="input">
                    {lk.types.map((t) => (
                      <option key={t.name}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Mode</span>
                  <select name={`mode_${l.id}`} className="input">
                    <option>Single</option>
                    <option>Counted</option>
                  </select>
                </label>
                <label className="field">
                  <span>Model</span>
                  <input name={`model_${l.id}`} className="input" />
                </label>
                <label className="field">
                  <span>Brand</span>
                  <input name={`brand_${l.id}`} className="input" />
                </label>
                {u.financeVisible && (
                  <label className="field">
                    <span>Unit price (Rs)</span>
                    <input name={`price_${l.id}`} type="number" step="0.01" className="input" />
                  </label>
                )}
              </fieldset>
            ))}
            <label className="field">
              <span>Delivered on</span>
              <input name="delivered_at" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <Submit>Receive and create items</Submit>
          </ActionForm>
        </Section>
      )}
      {can.orders(u) && d.o.status === "Placed" && (
        <Section title="Cancel order">
          <ActionForm action={cancelOrder} className="flex gap-2">
            <input type="hidden" name="order_id" value={id} />
            <input name="reason" className="input" required placeholder="Reason" />
            <Submit className="btn btn-danger">Cancel order</Submit>
          </ActionForm>
        </Section>
      )}
    </>
  );
}
