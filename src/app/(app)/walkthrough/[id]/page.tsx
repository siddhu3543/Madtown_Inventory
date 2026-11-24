import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/services/items";
import { PageHeader, Section, Badge, ItemLink, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Scanner } from "@/components/Scanner";
import { PhotoCapture } from "@/components/PhotoCapture";
import { record, close, correct, bulkMissing } from "../actions";
import { fmtDateTime } from "@/lib/format";
export const metadata = { title: "Walkthrough session" };

export default async function Session({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ item?: string }> }) {
  const u = await requireUser(["Admin"]);
  const { id } = await params;
  const sp = await searchParams;
  const d = await withUser(u.id, async (c) => {
    const a = (await c.query("select * from audits where id = $1", [id])).rows[0];
    if (!a) return null;
    const scope =
      a.scope_kind === "All"
        ? "true"
        : a.scope_kind === "Type"
          ? "v.type = $1"
          : a.scope_kind === "Location"
            ? "(v.holder_location_id in (select id from locations where name = $1) or v.home_location_id in (select id from locations where name = $1))"
            : "(v.holder_label = $1 or exists (select 1 from item_holdings h left join people p on p.id = h.holder_person_id left join locations l on l.id = h.holder_location_id where h.item_id = v.id and coalesce(p.name, l.name) = $1))";
    const expected = (
      await c.query(
        `select v.id, v.name, v.quantity_mode, v.stock, v.lost_qty, v.out_qty, v.display_status, v.condition, v.holder_label, v.home_location_id
                                       from items_v v where v.is_active and ${scope} order by v.id`,
        a.scope_kind === "All" ? [] : [a.scope_value],
      )
    ).rows;
    const lines = (
      await c.query(
        "select l.*, i.name, i.quantity_mode, i.stock, loc.name loc from audit_lines l join items i on i.id = l.item_id left join locations loc on loc.id = l.location_seen_id where l.audit_id = $1 order by l.scanned_at desc",
        [id],
      )
    ).rows;
    const current = sp.item
      ? (
          await c.query("select v.*, (select row_to_json(x) from audit_lines x where x.audit_id = $2 and x.item_id = v.id) line from items_v v where v.id = $1", [
            sp.item.toUpperCase(),
            id,
          ])
        ).rows[0]
      : null;
    return { a, expected, lines, current };
  });
  if (!d) notFound();
  const lk = await lookups(u);
  const scanned = new Set(d.lines.map((l) => l.item_id));
  const notScanned = d.expected.filter((e) => !scanned.has(e.id));
  const open = d.a.status === "Open";
  const variances = d.lines.filter((l) => l.result !== "Found" || (l.counted_qty != null && l.counted_qty !== l.expected_qty));
  const cur = d.current;
  return (
    <>
      <PageHeader
        title={`Walkthrough: ${d.a.scope_kind}${d.a.scope_value ? ` — ${d.a.scope_value}` : ""}`}
        phase={2}
        sub={
          <>
            <Badge v={d.a.status} /> · started {fmtDateTime(d.a.started_at)} · {scanned.size} of {d.expected.length} in scope scanned
          </>
        }
      />
      {open && can.walkthroughAssist(u) && (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Section title="Scan next item" id="scan">
            <Scanner walkthroughId={id} />
          </Section>
          {cur && (
            <Section title={`Record ${cur.id} ${cur.name}`}>
              <p className="mb-2">
                <Badge v={cur.display_status} />{" "}
                {cur.quantity_mode === "Counted" && (
                  <>
                    Expected on the shelf: <b>{cur.stock - cur.lost_qty - cur.out_qty}</b> (stock {cur.stock}, out {cur.out_qty}, lost {cur.lost_qty})
                  </>
                )}
                {!d.expected.some((e) => e.id === cur.id) && <Flag>outside this walkthrough&apos;s scope</Flag>}
              </p>
              <ActionForm action={record} className="flex flex-col gap-2">
                <input type="hidden" name="audit_id" value={id} />
                <input type="hidden" name="item_id" value={cur.id} />
                <label className="field">
                  <span>Result</span>
                  <select name="result" className="input" defaultValue="Found" data-testid="wt-result">
                    {["Found", "Not found", "Wrong location", "Condition changed"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                {cur.quantity_mode === "Counted" && (
                  <label className="field">
                    <span>Counted quantity</span>
                    <input name="counted_qty" type="number" min={0} className="input" data-testid="wt-count" required />
                  </label>
                )}
                <label className="field">
                  <span>Condition seen</span>
                  <select name="condition_seen" className="input" defaultValue={cur.condition ?? ""}>
                    <option value="">(not checked)</option>
                    {lk.conditions.map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Location seen</span>
                  <select name="location_seen_id" className="input">
                    <option value="">(expected place)</option>
                    {lk.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>
                    Quick note <span className="phase">P3</span>
                  </span>
                  <input name="note" className="input" placeholder="e.g. strap frayed" />
                </label>
                <PhotoCapture itemId={cur.id} kind="Audit" label="Optional photo" />
                <Submit>Save</Submit>
              </ActionForm>
            </Section>
          )}
        </div>
      )}
      <Section title={`Variance report (${variances.length})`}>
        {variances.length ? (
          <table className="tbl" data-testid="variance">
            <thead>
              <tr>
                <th>Item</th>
                <th>Result</th>
                <th>Expected</th>
                <th>Counted</th>
                <th>Stock</th>
                <th>Seen</th>
                <th>Correction</th>
              </tr>
            </thead>
            <tbody>
              {variances.map((l) => (
                <tr key={l.id}>
                  <td>
                    <ItemLink id={l.item_id} name={l.name} />
                  </td>
                  <td>
                    <Badge v={l.result} />
                  </td>
                  <td>{l.expected_qty}</td>
                  <td>{l.counted_qty ?? "—"}</td>
                  <td>{l.stock}</td>
                  <td>{[l.condition_seen, l.loc, l.note].filter(Boolean).join(" · ")}</td>
                  <td>
                    {l.correction_applied ? (
                      <Flag tone="ok">{l.correction_note}</Flag>
                    ) : (
                      can.applyCorrections(u) && (
                        <details>
                          <summary className="cursor-pointer">Apply…</summary>
                          <ActionForm action={correct} className="mt-1 flex flex-col gap-1">
                            <input type="hidden" name="audit_id" value={id} />
                            <input type="hidden" name="line_id" value={l.id} />
                            <select name="action" className="input">
                              {l.quantity_mode === "Counted" && l.counted_qty != null && <option value="set_count">Set shelf count to {l.counted_qty}</option>}
                              {l.condition_seen && <option value="set_condition">Set condition {l.condition_seen}</option>}
                              {l.loc && <option value="set_location">Set location {l.loc}</option>}
                              {l.result === "Not found" && <option value="mark_missing">Mark Missing</option>}
                              <option value="none">No change (note only)</option>
                            </select>
                            {l.quantity_mode === "Counted" && (
                              <>
                                <input type="hidden" name="available_qty" value={l.counted_qty ?? 0} />
                                <input type="hidden" name="location_id" value={lk.locations[0]?.id} />
                                <label className="text-sm">
                                  Units not found → Missing{" "}
                                  <input name="missing_qty" type="number" min={0} defaultValue={Math.max(0, (l.expected_qty ?? 0) - (l.counted_qty ?? 0))} className="input w-20" />
                                </label>
                              </>
                            )}
                            <input name="note" className="input" placeholder="Reason" />
                            <Submit className="btn btn-sm btn-primary">Apply</Submit>
                          </ActionForm>
                        </details>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No variances so far.</p>
        )}
      </Section>
      <Section title={`Not scanned yet (${notScanned.length})`}>
        <ul className="columns-1 text-sm sm:columns-2" data-testid="not-scanned">
          {notScanned.map((e) => (
            <li key={e.id}>
              <ItemLink id={e.id} name={e.name} />
            </li>
          ))}
        </ul>
        {open && can.walkthrough(u) && notScanned.length > 0 && (
          <ActionForm action={bulkMissing} className="mt-3">
            <input type="hidden" name="audit_id" value={id} />
            {notScanned.map((e) => (
              <input key={e.id} type="hidden" name="item_id" value={e.id} />
            ))}
            <Submit className="btn btn-secondary" confirm={`Move all ${notScanned.length} unscanned item(s) to Missing?`}>
              Move all not found to Missing
            </Submit>
          </ActionForm>
        )}
      </Section>
      {open && can.walkthrough(u) && (
        <ActionForm action={close}>
          <input type="hidden" name="audit_id" value={id} />
          <input type="hidden" name="not_scanned" value={notScanned.length} />
          <Submit className="btn btn-primary w-full">Close walkthrough and send variance report</Submit>
        </ActionForm>
      )}
      <Section title="All scans">
        <ul className="text-sm">
          {d.lines.map((l) => (
            <li key={l.id}>
              {fmtDateTime(l.scanned_at)} · {l.item_id} · {l.result}
              {l.counted_qty != null ? ` · ${l.counted_qty}` : ""}
              {l.note ? ` · ${l.note}` : ""}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
