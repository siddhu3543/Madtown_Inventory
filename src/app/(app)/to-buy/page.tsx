import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Badge, Flag } from "@/components/ui";
export const metadata = { title: "To-buy" };
/** SCR-17 wishlist with status, priority, approval actions, researched options */
export default async function ToBuy({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const u = await requireUser(["Admin"]);
  const sp = await searchParams;
  const rows = await withUser(
    u.id,
    async (c) =>
      (
        await c.query(
          `select w.*, (select string_agg(r.item_id, ', ' order by r.item_id) from wishlist_related_items r where r.wishlist_id = w.id) rel
     ${u.financeVisible ? ", f.estimated_cost" : ""} from wishlist_v w ${u.financeVisible ? "left join wishlist_financials f on f.wishlist_id = w.id" : ""}
     where ($1::text is null or w.status = $1) order by case w.status when 'To buy' then 0 when 'To research' then 1 when 'Approved' then 2 when 'Ordered' then 3 else 4 end,
       case w.priority when 'High' then 0 when 'Medium' then 1 else 2 end, w.created_at`,
          [sp.status ?? null],
        )
      ).rows,
  );
  return (
    <>
      <PageHeader
        title="To-buy"
        phase={2}
        sub={`${rows.length} line(s)`}
        actions={
          <>
            {["To buy", "To research", "Approved", "Ordered", "Received", "Rejected"].map((s) => (
              <Link key={s} href={`/to-buy?status=${encodeURIComponent(s)}`} className="btn btn-sm btn-secondary">
                {s}
              </Link>
            ))}
            {can.proposeBuy(u) && (
              <Link href="/to-buy/new" className="btn btn-primary">
                Propose
              </Link>
            )}
          </>
        }
      />
      <div className="card overflow-x-auto">
        <table className="tbl" data-testid="tobuy-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Related</th>
              <th>Purpose</th>
              <th>Priority</th>
              <th>Status</th>
              {u.financeVisible && <th>Est. cost</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td>
                  <Link href={`/to-buy/${w.id}`} className="font-semibold">
                    {w.item_description}
                  </Link>
                  {w.verify_first && !w.verified_at && <Flag>verify first</Flag>}
                  <div className="muted text-sm">{w.reason}</div>
                </td>
                <td>{w.rel ?? "—"}</td>
                <td>
                  {w.replaces_or_adds}
                  {w.replaces_or_adds_note ? ` ${w.replaces_or_adds_note}` : ""}
                </td>
                <td>{w.priority}</td>
                <td>
                  <Badge v={w.status} />
                </td>
                {u.financeVisible && <td>{w.estimated_cost ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
