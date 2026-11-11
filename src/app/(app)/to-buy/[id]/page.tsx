import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, KV, ItemLink, Flag, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { decide, verify, addOption, linkItems, setStatus } from "../actions";
import { fmtDateTime, fmtRs } from "@/lib/format";
export const metadata = { title: "To-buy line" };
export default async function Line({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const d = await withUser(u.id, async (c) => ({
    w: (
      await c.query(
        `select w.*, pp.name proposer, ap.name approver, rp.name rejecter, vp.name verifier from wishlist_v w
      left join users pu on pu.id = w.proposed_by left join people pp on pp.id = pu.person_id left join users au on au.id = w.approved_by left join people ap on ap.id = au.person_id
      left join users ru on ru.id = w.rejected_by left join people rp on rp.id = ru.person_id left join users vu on vu.id = w.verified_by left join people vp on vp.id = vu.person_id where w.id = $1`,
        [id],
      )
    ).rows[0],
    rel: (await c.query("select v.id, v.name, v.display_status from wishlist_related_items r join items_v v on v.id = r.item_id where r.wishlist_id = $1 order by v.id", [id]))
      .rows,
    opts: u.financeVisible ? (await c.query("select * from wishlist_options where wishlist_id = $1 order by price nulls last", [id])).rows : [],
    fin: u.financeVisible ? (await c.query("select * from wishlist_financials where wishlist_id = $1", [id])).rows[0] : null,
    orders: can.viewOrders(u)
      ? (await c.query("select o.id, o.vendor, o.order_ref, o.status from order_lines ol join orders o on o.id = ol.order_id where ol.wishlist_id = $1", [id])).rows
      : [],
  }));
  if (!d.w) notFound();
  const w = d.w;
  return (
    <>
      <PageHeader
        title={w.item_description}
        phase={2}
        sub={
          <>
            <Badge v={w.status} /> {w.priority} priority {w.legacy && <Flag>from sheet</Flag>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Details">
          <KV
            rows={[
              ["Reason", w.reason],
              ["Purpose", `${w.replaces_or_adds}${w.replaces_or_adds_note ? ` ${w.replaces_or_adds_note}` : ""}`],
              ["Notes", w.notes],
              ["Links", w.links],
              ["Proposed", `${w.proposer ?? "imported from sheet"}, ${fmtDateTime(w.proposed_at)}`],
              [
                "Decision",
                w.approved_at ? (
                  <span key="a" data-testid="approval">
                    Approved by {w.approver} on {fmtDateTime(w.approved_at)}
                    {w.decision_comment ? ` — ${w.decision_comment}` : ""}
                  </span>
                ) : w.rejected_at ? (
                  `Rejected by ${w.rejecter} on ${fmtDateTime(w.rejected_at)} — ${w.decision_comment}`
                ) : (
                  "Not decided"
                ),
              ],
              [
                "Verify first",
                w.verify_first ? (
                  w.verified_at ? (
                    `Verified by ${w.verifier}: ${w.verification_result}`
                  ) : (
                    <Flag key="v">Not yet verified{w.verify_note ? `: ${w.verify_note}` : ""}</Flag>
                  )
                ) : (
                  "No"
                ),
              ],
              ...(u.financeVisible ? [["Estimated cost", fmtRs(d.fin?.estimated_cost)] as [string, React.ReactNode]] : []),
            ]}
          />
        </Section>
        <Section title="Related items (FR-BUY-008)">
          {d.rel.length ? (
            <ul>
              {d.rel.map((r) => (
                <li key={r.id}>
                  <ItemLink id={r.id} name={r.name} /> <Badge v={r.display_status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>None linked.</Empty>
          )}
          {can.repairs(u) && (
            <ActionForm action={linkItems} className="mt-2 flex gap-2">
              <input type="hidden" name="wishlist_id" value={id} />
              <input name="related" className="input" placeholder="Item IDs" />
              <Submit className="btn btn-secondary">Link</Submit>
            </ActionForm>
          )}
          {d.orders.length > 0 && (
            <>
              <h3 className="mt-3 font-semibold">Orders</h3>
              <ul>
                {d.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`}>
                      {o.vendor} {o.order_ref}
                    </Link>{" "}
                    <Badge v={o.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>
      {can.approveBuy(u) && ["To research", "To buy"].includes(w.status) && (
        <Section title="Owner decision (FR-BUY-005)">
          <ActionForm action={decide} className="flex flex-wrap gap-2">
            <input type="hidden" name="wishlist_id" value={id} />
            <input name="comment" className="input w-72" placeholder="Comment (required to reject)" />
            <Submit name="d" value="approve">
              Approve
            </Submit>
            <Submit name="d" value="reject" className="btn btn-secondary">
              Reject
            </Submit>
          </ActionForm>
        </Section>
      )}
      {can.repairs(u) && w.verify_first && !w.verified_at && (
        <Section title="Record verification (FR-BUY-009)">
          <ActionForm action={verify} className="flex gap-2">
            <input type="hidden" name="wishlist_id" value={id} />
            <input name="result" className="input" placeholder="e.g. Anand confirmed 2 chargers exist; buy 1" required />
            <Submit>Save</Submit>
          </ActionForm>
        </Section>
      )}
      {can.repairs(u) && ["To research", "To buy"].includes(w.status) && (
        <Section title="Status">
          <ActionForm action={setStatus} className="flex gap-2">
            <input type="hidden" name="wishlist_id" value={id} />
            <Submit name="status" value={w.status === "To buy" ? "To research" : "To buy"} className="btn btn-secondary">
              Move to {w.status === "To buy" ? "To research" : "To buy"}
            </Submit>
          </ActionForm>
        </Section>
      )}
      {u.financeVisible && (
        <Section title={<>Researched options (FR-BUY-010)</>}>
          {d.opts.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {d.opts.map((o) => (
                  <tr key={o.id}>
                    <td>{o.vendor}</td>
                    <td>{fmtRs(o.price)}</td>
                    <td>{o.stock_note}</td>
                    <td>{o.link && <a href={o.link}>link</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No options yet.</Empty>
          )}
          {can.repairs(u) && (
            <ActionForm action={addOption} className="mt-2 grid gap-2 sm:grid-cols-5" resetOnSuccess>
              <input type="hidden" name="wishlist_id" value={id} />
              <input name="vendor" className="input" placeholder="Vendor" required />
              <input name="price" type="number" className="input" placeholder="Price" />
              <input name="stock_note" className="input" placeholder="Stock note" />
              <input name="link" className="input" placeholder="Link" />
              <Submit>Add</Submit>
            </ActionForm>
          )}
        </Section>
      )}
      {can.orders(u) && w.status === "Approved" && (
        <p className="mt-2">
          <Link href={`/orders/new?wishlist=${id}`} className="btn btn-primary">
            Record an order for this line
          </Link>
        </p>
      )}
    </>
  );
}
