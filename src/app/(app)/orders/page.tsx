import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Badge } from "@/components/ui";
import { fmtDate, fmtRs } from "@/lib/format";
export const metadata = { title: "Orders" };
/** SCR-18 incoming orders and delivery status */
export default async function Orders() {
  const u = await requireUser(["Owner", "Manager", "Read-only"]);
  const rows = await withUser(
    u.id,
    async (c) =>
      (
        await c.query(`select o.* ${u.financeVisible ? ", f.amount" : ""}, (select count(*) from order_lines ol where ol.order_id = o.id)::int lines
     from orders o ${u.financeVisible ? "left join order_financials f on f.order_id = o.id" : ""} order by o.order_date desc`)
      ).rows,
  );
  return (
    <>
      <PageHeader
        title="Orders"
        phase={2}
        actions={
          can.orders(u) ? (
            <Link href="/orders/new" className="btn btn-primary">
              Record order
            </Link>
          ) : null
        }
      />
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Order</th>
              <th>Date</th>
              <th>Expected</th>
              <th>Delivered</th>
              <th>Status</th>
              {u.financeVisible && <th>Amount</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>{o.vendor}</td>
                <td>
                  <Link href={`/orders/${o.id}`} className="font-semibold">
                    {o.order_ref}
                  </Link>
                </td>
                <td>{fmtDate(o.order_date)}</td>
                <td>{fmtDate(o.expected_delivery)}</td>
                <td>{fmtDate(o.delivered_at)}</td>
                <td>
                  <Badge v={o.status} />
                </td>
                {u.financeVisible && <td>{fmtRs(o.amount)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
