import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, ItemLink, Empty, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { resolve, decide } from "./actions";
import { fmtDate } from "@/lib/format";
export const metadata = { title: "Lost and found" };
/** SCR-16: Lost and Missing items, incidents, resolution actions (FR-LST) */
export default async function Lost() {
  const u = await requireUser();
  const d = await withUser(u.id, async (c) => ({
    lost: (await c.query("select * from items_v where flag_lost order by id")).rows,
    missing: (await c.query("select * from items_v where flag_missing order by id")).rows,
    inc: (
      await c.query(`select i.*, it.name, lk.name lk, rp.name rp, w.item_description wl from incidents i join items it on it.id = i.item_id
       left join people lk on lk.id = i.last_known_holder_person_id left join people rp on rp.id = i.responsible_person_id left join wishlist_items w on w.id = i.replaced_wishlist_id
       where i.type <> 'Found' order by (i.status = 'Resolved'), i.reported_at desc`)
    ).rows,
    wl: (await c.query("select id, item_description from wishlist_items where status not in ('Rejected') order by created_at desc limit 200")).rows,
  }));
  const L = ({ rows, t }: { rows: typeof d.lost; t: string }) =>
    rows.length ? (
      <ul data-testid={t}>
        {rows.map((r) => (
          <li key={r.id}>
            <ItemLink id={r.id} name={r.name} /> <Badge v={r.display_status} />
            {r.quantity_mode === "Counted" && ` · ${r.lost_qty} lost / ${r.missing_qty} missing of ${r.stock}`}
          </li>
        ))}
      </ul>
    ) : (
      <Empty>None.</Empty>
    );
  return (
    <>
      <PageHeader title="Lost and found" sub="Lost = confirmed lost. Missing = whereabouts unknown, search open. Scanning a Lost or Missing item offers Mark as found." />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={`Lost (${d.lost.length})`}>
          <L rows={d.lost} t="lost-list" />
        </Section>
        <Section title={`Missing (${d.missing.length})`}>
          <L rows={d.missing} t="missing-list" />
        </Section>
      </div>
      <Section title="Incidents">
        {d.inc.length ? (
          <ul className="flex flex-col gap-3">
            {d.inc.map((i) => (
              <li key={i.id} id={i.id} className="border-b border-[var(--color-line)] pb-3">
                <div>
                  <ItemLink id={i.item_id} name={i.name} /> · <b>{i.type}</b> ×{i.quantity} <Badge v={i.status} /> {i.legacy && <Flag>from sheet</Flag>}{" "}
                  {!i.history_known && <Flag>history unknown</Flag>}
                </div>
                <div className="text-sm">{i.description}</div>
                <div className="muted text-sm">
                  {[
                    i.last_seen_place && `last seen ${i.last_seen_place}`,
                    i.last_seen_at_text ?? (i.last_seen_at && fmtDate(i.last_seen_at)),
                    i.lk && `last holder ${i.lk}`,
                    i.rp && `responsible ${i.rp}`,
                    i.linked_loan_id && "linked to a loan",
                    i.resolution && `resolved: ${i.resolution}`,
                    i.insurance_claim_ref && `claim ${i.insurance_claim_ref}`,
                    i.wl && `replacement: ${i.wl}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {i.linked_loan_id && (
                    <>
                      {" "}
                      · <Link href={`/loans/${i.linked_loan_id}`}>loan</Link>
                    </>
                  )}
                </div>
                {i.status === "Pending write-off" && can.approveBuy(u) && (
                  <ActionForm action={decide} className="mt-2 flex flex-wrap gap-2">
                    <input type="hidden" name="incident_id" value={i.id} />
                    <input name="comment" className="input w-64" placeholder="Comment" />
                    <Submit name="d" value="approve">
                      Approve write-off
                    </Submit>
                    <Submit name="d" value="reject" className="btn btn-secondary">
                      Reject
                    </Submit>
                  </ActionForm>
                )}
                {i.status === "Open" && can.repairs(u) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-semibold">
                      Resolve <span className="phase">P2</span>
                    </summary>
                    <ActionForm action={resolve} className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input type="hidden" name="incident_id" value={i.id} />
                      <select name="resolution" className="input">
                        <option>Written off</option>
                        <option>Insurance claim</option>
                        <option>Replaced</option>
                      </select>
                      <input name="note" className="input" placeholder="Reason / note" required />
                      <input name="claim_ref" className="input" placeholder="Insurance claim reference" />
                      <select name="wishlist_id" className="input">
                        <option value="">Replacement to-buy line…</option>
                        {d.wl.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.item_description}
                          </option>
                        ))}
                      </select>
                      <Submit>Resolve</Submit>
                      <p className="muted text-sm">Found? Open the item and use Mark as found. Write-off needs the Owner.</p>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No incidents.</Empty>
        )}
      </Section>
    </>
  );
}
