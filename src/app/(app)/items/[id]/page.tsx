import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getItemFull, lookups } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Section, Badge, Cond, KV, ItemLink, Empty, Flag, Phase } from "@/components/ui";
import { Thumb } from "@/components/Thumb";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PhotoCapture } from "@/components/PhotoCapture";
import { fmtDate, fmtDateTime, fmtRs, toIstInput } from "@/lib/format";
import * as A from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id };
}

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scanned?: string; found?: string; created?: string }>;
}) {
  const u = await requireUser();
  const id = decodeURIComponent((await params).id)
    .trim()
    .toUpperCase();
  const sp = await searchParams;
  const d = await getItemFull(u, id);
  if (!d) notFound();
  const lk = await lookups(u);
  const { item: it } = d;
  const openLoan = d.loans.find((l) => l.line_active);
  const isMine = openLoan && openLoan.borrower_person_id === u.personId;
  const lostOrMissing = it.status === "Lost" || it.status === "Missing" || it.lost_qty > 0 || it.missing_qty > 0;
  const stock = d.photos.find((p) => p.id === it.stock_image_photo_id);
  const latest = d.photos.find((p) => p.id === it.latest_photo_id);
  const splitEnabled = await withUser(u.id, async (c) => (await c.query("select coalesce((app.setting('split_enabled') #>> '{}')::boolean,false) e")).rows[0].e);

  // FR-QR-003: correct primary action for the current status
  let primary: React.ReactNode = null;
  if (lostOrMissing && it.quantity_mode === "Single" && can.report(u))
    primary = (
      <a href="#found" className="btn btn-primary w-full text-lg" data-testid="primary-action">
        Mark as found
      </a>
    );
  else if (openLoan && can.checkin(u) && (isMine || can.checkoutOthers(u)) && it.quantity_mode === "Single")
    primary = (
      <Link href={`/loans/${openLoan.id}`} className="btn btn-primary w-full text-lg" data-testid="primary-action">
        Check in
      </Link>
    );
  else if (it.status === "Available" && it.is_active && can.checkoutSelf(u) && (it.quantity_mode === "Single" || it.available_qty > 0))
    primary = (
      <Link href={`/items/${it.id}/checkout`} className="btn btn-primary w-full text-lg" data-testid="primary-action">
        Check out
      </Link>
    );
  else if (it.quantity_mode === "Counted" && it.available_qty > 0 && can.checkoutSelf(u) && it.is_active)
    primary = (
      <Link href={`/items/${it.id}/checkout`} className="btn btn-primary w-full text-lg" data-testid="primary-action">
        Check out
      </Link>
    );
  else if (can.report(u))
    primary = (
      <a href="#report" className="btn btn-secondary w-full text-lg" data-testid="primary-action">
        Report issue
      </a>
    );

  const people = lk.people.filter((p) => !p.is_madtown && p.active);
  const holderOpts = [...lk.locations.map((l) => ({ v: `l:${l.id}`, n: `${l.name} (location)` })), ...people.map((p) => ({ v: `p:${p.id}`, n: p.name }))];

  type T = { at: string; kind: string; text: React.ReactNode };
  const timeline: T[] = [
    ...d.events.map((e) => ({
      at: e.at,
      kind: "Loan",
      text: (
        <>
          <b>{e.event}</b>
          {e.quantity > 1 ? ` ×${e.quantity}` : ""} {e.person_name ? `· ${e.person_name}` : ""} {e.by_name ? `(by ${e.by_name})` : ""} {e.note ? `— ${e.note}` : ""}{" "}
          <Link href={`/loans/${e.loan_id}`}>loan</Link>
        </>
      ),
    })),
    ...d.repairs.flatMap((m) =>
      (m.history ?? []).map((h: { to_state: string; at: string; by_name: string; note: string }) => ({
        at: h.at,
        kind: m.type,
        text: (
          <>
            <b>{h.to_state}</b> — {m.issue_description} {h.by_name ? `(by ${h.by_name})` : ""}
          </>
        ),
      })),
    ),
    ...d.repairs
      .filter((m) => m.legacy)
      .map((m) => ({
        at: m.reported_at,
        kind: m.type,
        text: (
          <>
            <b>{m.type}</b> {m.event_date_text ?? fmtDate(m.event_date)} {m.year_to_verify && <Flag>year to verify</Flag>} (imported)
          </>
        ),
      })),
    ...d.incidents.map((i) => ({
      at: i.reported_at,
      kind: "Incident",
      text: (
        <>
          <b>{i.type}</b> ×{i.quantity} — {i.description} <Badge v={i.status} />
        </>
      ),
    })),
    ...d.photos.map((p) => ({
      at: p.taken_at,
      kind: "Photo",
      text: (
        <>
          {p.kind} photo {p.taken_by_name ? `by ${p.taken_by_name}` : ""}{" "}
          {p.upload_state !== "uploaded" && p.upload_state !== "legacy" ? <Flag tone="bad">{p.upload_state}</Flag> : null}
        </>
      ),
    })),
    ...d.audits.map((a) => ({
      at: a.scanned_at,
      kind: "Audit",
      text: (
        <>
          Walkthrough: <b>{a.result}</b>
          {a.counted_qty != null ? ` counted ${a.counted_qty}/${a.expected_qty}` : ""} {a.note ? `— ${a.note}` : ""}
        </>
      ),
    })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <>
      {sp.scanned && (
        <p className="mb-2 font-semibold text-[var(--color-ok)]" data-testid="scanned-banner">
          Scanned {it.id}
        </p>
      )}
      {sp.found && (
        <p role="status" className="mb-2 rounded-md border-2 border-[var(--color-ok)] p-3 font-semibold text-[var(--color-ok)]" data-testid="form-ok">
          Marked as found. Managers were notified.
        </p>
      )}
      {sp.created && (
        <p role="status" className="mb-2 rounded-md border-2 border-[var(--color-ok)] p-3 font-semibold text-[var(--color-ok)]">
          Created {it.id}. Add a stock photo and print its QR label.
        </p>
      )}
      <PageHeader
        title={`${it.id} · ${it.name}`}
        sub={<>{[it.brand, it.type, it.subtype, it.model_number ?? (it.model_tbd ? "Model TBD" : null)].filter(Boolean).join(" · ")}</>}
        actions={
          <>
            {can.editItems(u) && (
              <Link href={`/items/${it.id}/edit`} className="btn btn-secondary">
                Edit
              </Link>
            )}
            {can.labels(u) && (
              <Link href={`/labels?ids=${it.id}`} className="btn btn-secondary">
                Print label
              </Link>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <div>
          <div className="card mb-4 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="item-status">
              <Badge v={it.display_status} /> <Cond v={it.condition} />
              {!it.owned_by_madtown && <Flag>Owned by {it.owner_name} — not a Madtown asset</Flag>}
              {it.flag_to_verify && (
                <Flag>
                  To verify{it.to_verify_reason ? `: ${it.to_verify_reason}` : ""}
                  {it.stock_to_verify_reason ? ` · ${it.stock_to_verify_reason}` : ""}
                </Flag>
              )}
              {it.status === "Retired" && (
                <Flag tone="bad">
                  {it.retirement_kind}: {it.retired_reason}
                </Flag>
              )}
            </div>
            {primary && <div className="mb-3 no-print">{primary}</div>}
            <div className="mb-4 grid grid-cols-2 gap-3">
              <figure>
                <figcaption className="muted mb-1 text-sm font-semibold">Stock image</figcaption>
                {stock?.upload_state === "legacy" ? <LegacyPhoto p={stock} /> : <Thumb id={stock?.id} alt="stock image" size={150} full />}
              </figure>
              <figure>
                <figcaption className="muted mb-1 text-sm font-semibold">Latest photo</figcaption>
                {latest?.upload_state === "legacy" ? <LegacyPhoto p={latest} /> : <Thumb id={latest?.id} alt="latest photo" size={150} full />}
                {!latest && d.photos.find((p) => p.kind === "Latest" && p.link_kind === "text") && (
                  <p className="text-sm muted">Sheet says: “{d.photos.find((p) => p.kind === "Latest" && p.link_kind === "text")?.legacy_text}”</p>
                )}
              </figure>
            </div>
            <KV
              rows={[
                [
                  "Item ID",
                  <span key="i" data-testid="item-id">
                    {it.id}
                  </span>,
                ],
                [
                  "Quantity",
                  it.quantity_mode === "Counted" ? (
                    <span
                      key="q"
                      data-testid="qty"
                    >{`Counted · stock ${it.stock} · available ${it.available_qty} · out ${it.out_qty} · lost ${it.lost_qty}${it.missing_qty ? ` · missing ${it.missing_qty}` : ""}${it.in_repair_qty ? ` · in repair ${it.in_repair_qty}` : ""}`}</span>
                  ) : (
                    "Single (one tagged unit)"
                  ),
                ],
                [
                  "Owner",
                  <span key="o" data-testid="owner">
                    {it.owner_name}
                  </span>,
                ],
                ["Current holder", it.quantity_mode === "Counted" ? (it.holder_names ?? "—") : (it.holder_label ?? "—")],
                ["Home location", lk.locations.find((l) => l.id === it.home_location_id)?.name ?? "—"],
                ["Serial number", it.serial_number ?? "—"],
                ["Parent item", d.parent ? <ItemLink key="p" id={d.parent.id} name={d.parent.name} /> : "—"],
                ["Travels in", d.caseItem ? <ItemLink key="c" id={d.caseItem.id} name={d.caseItem.name} /> : it.needs_case ? <Flag key="n">Needs a case</Flag> : "—"],
                ["Case capacity", it.case_capacity_note ?? "—"],
                ["Label", `${it.label_target}${it.label_note ? ` — ${it.label_note}` : ""}`],
                ["Last audited", fmtDate(it.last_audited_at)],
                [
                  "Notes",
                  <span key="n" className="whitespace-pre-wrap">
                    {it.notes ?? "—"}
                  </span>,
                ],
                ...(it.imported ? [["Sheet row", String(it.sheet_row)] as [string, React.ReactNode]] : []),
              ]}
            />
          </div>

          {it.quantity_mode === "Counted" && (
            <Section
              title="Quantity by holder and status"
              actions={
                can.editItems(u) && it.is_active ? (
                  <a href="#adjust" className="btn btn-sm btn-secondary">
                    Correct stock
                  </a>
                ) : null
              }
            >
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Holder</th>
                    <th>Status</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {d.holdings.map((h) => (
                    <tr key={h.id}>
                      <td>{h.person_name ?? h.location_name ?? "—"}</td>
                      <td>
                        <Badge v={h.status} />
                      </td>
                      <td>
                        {h.quantity}
                        {h.to_verify ? " (to confirm)" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section title={<>Parts, kits and accessories</>}>
            <h3 className="font-semibold">Children / accessories</h3>
            {d.children.length ? (
              <ul className="mb-3">
                {d.children.map((c) => (
                  <li key={c.id}>
                    <ItemLink id={c.id} name={c.name} /> <Badge v={c.display_status} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>None linked.</Empty>
            )}
            {d.carried.length > 0 && (
              <>
                <h3 className="font-semibold">Carried in this case</h3>
                <ul className="mb-3">
                  {d.carried.map((c) => (
                    <li key={c.id}>
                      <ItemLink id={c.id} name={c.name} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3 className="font-semibold">
              Kit memberships <Phase n={2} />
            </h3>
            {d.kits.length ? (
              <ul className="mb-3">
                {d.kits.map((k) => (
                  <li key={k.id}>
                    <Link href={`/kits/${k.id}`}>
                      {k.id} {k.name}
                    </Link>{" "}
                    {k.required ? "(required part)" : "(optional)"}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Not in a kit.</Empty>
            )}
            <h3 className="font-semibold" id="missing-parts">
              Missing parts
            </h3>
            {d.missingParts.length ? (
              <ul className="mb-3 flex flex-col gap-2" data-testid="missing-parts">
                {d.missingParts.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2">
                    <Badge v={m.status === "Missing" ? "Missing" : "Resolved"} /> {m.description}
                    {m.quantity > 1 ? ` ×${m.quantity}` : ""}
                    {m.legacy && <Flag>from sheet notes, to verify</Flag>}
                    {m.wishlist_id ? (
                      <Link href={`/to-buy/${m.wishlist_id}`} data-testid="missing-part-tobuy">
                        To-buy: {m.wishlist_description} ({m.wishlist_status})
                      </Link>
                    ) : (
                      can.proposeBuy(u) &&
                      m.status === "Missing" && (
                        <ActionForm action={A.toBuyFromDefect} className="inline">
                          <input type="hidden" name="item_id" value={it.id} />
                          <input type="hidden" name="missing_part_id" value={m.id} />
                          <input type="hidden" name="description" value={`${it.name}: ${m.description}`} />
                          <input type="hidden" name="reason" value={`Missing part on ${it.id}`} />
                          <input type="hidden" name="replaces_or_adds" value="Replaces" />
                          <Submit className="btn btn-sm btn-secondary">Create to-buy line</Submit>
                        </ActionForm>
                      )
                    )}
                    {can.editItems(u) && m.status === "Missing" && (
                      <ActionForm action={A.updateMissingPart} className="inline">
                        <input type="hidden" name="item_id" value={it.id} />
                        <input type="hidden" name="id" value={m.id} />
                        <Submit className="btn btn-sm btn-secondary" name="status" value="Found">
                          Found
                        </Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No missing parts recorded.</Empty>
            )}
            {can.report(u) && (
              <details className="mb-3">
                <summary className="cursor-pointer font-semibold">Record a missing part</summary>
                <ActionForm action={A.addMissingPart} className="mt-2 flex flex-wrap items-end gap-2" resetOnSuccess>
                  <input type="hidden" name="item_id" value={it.id} />
                  <label className="field flex-1">
                    <span>What is missing</span>
                    <input name="description" className="input" required placeholder="e.g. charging cable" />
                  </label>
                  <label className="field w-24">
                    <span>Qty</span>
                    <input name="quantity" type="number" min={1} defaultValue={1} className="input" />
                  </label>
                  <Submit>Save</Submit>
                </ActionForm>
              </details>
            )}
            <h3 className="font-semibold">
              Detached accessories (held by someone else) <Phase n={2} />
            </h3>
            {d.detached.filter((x) => !x.returned_at).length ? (
              <ul>
                {d.detached
                  .filter((x) => !x.returned_at)
                  .map((x) => (
                    <li key={x.id}>
                      {x.description} — with <b>{x.holder_name}</b> since {fmtDate(x.since)} {x.reason ? `(${x.reason})` : ""}
                      {can.editItems(u) && (
                        <ActionForm action={A.returnDetached} className="inline">
                          <input type="hidden" name="id" value={x.id} />
                          <input type="hidden" name="item_id" value={it.id} />
                          <Submit className="btn btn-sm btn-secondary ml-2">Back with item</Submit>
                        </ActionForm>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <Empty>None.</Empty>
            )}
            {can.editItems(u) && (
              <details>
                <summary className="cursor-pointer font-semibold">Record detached accessory</summary>
                <ActionForm action={A.addDetached} className="mt-2 grid gap-2 sm:grid-cols-3" resetOnSuccess>
                  <input type="hidden" name="item_id" value={it.id} />
                  <label className="field">
                    <span>Accessory</span>
                    <input name="description" className="input" required placeholder="battery and charger" />
                  </label>
                  <label className="field">
                    <span>Held by</span>
                    <select name="holder_person_id" className="input" required>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Reason</span>
                    <input name="reason" className="input" placeholder="timely charging" />
                  </label>
                  <Submit>Save</Submit>
                </ActionForm>
              </details>
            )}
          </Section>

          <Section
            title={`Loans (${d.loanCount})`}
            actions={
              <Link href={`/loans?item=${it.id}`} className="btn btn-sm btn-secondary">
                All loans
              </Link>
            }
          >
            {d.loans.length ? (
              <table className="tbl" data-testid="item-loans">
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Out</th>
                    <th>Due</th>
                    <th>In</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.loans.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/loans/${l.id}`}>{l.borrower_name}</Link>
                        {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                        {l.legacy ? " (legacy)" : ""}
                      </td>
                      <td>{l.checked_out_at ? fmtDate(l.checked_out_at) : "unknown"}</td>
                      <td>{fmtDate(l.due_at)}</td>
                      <td>
                        {fmtDate(l.checked_in_at)}
                        {l.close_reason === "Transferred" ? " (transferred)" : ""}
                      </td>
                      <td>
                        <Badge v={l.status} />
                        {l.pending_evidence > 0 && <Flag tone="bad">evidence incomplete</Flag>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No loans yet.</Empty>
            )}
          </Section>

          <Section
            title={
              <>
                Repairs and servicing <Phase n={2} />
              </>
            }
            actions={
              can.repairs(u) ? (
                <a href="#repair" className="btn btn-sm btn-secondary">
                  Open repair
                </a>
              ) : null
            }
          >
            {d.repairs.length ? (
              <ul className="flex flex-col gap-2">
                {d.repairs.map((m) => (
                  <li key={m.id}>
                    <Link href={`/repairs/${m.id}`}>
                      <b>{m.type}</b>
                    </Link>{" "}
                    <Badge v={m.state} /> {m.issue_description}
                    {m.legacy && (
                      <>
                        {" "}
                        · {m.event_date_text ?? fmtDate(m.event_date)} {m.year_to_verify && <Flag>year to verify</Flag>}
                      </>
                    )}
                    {m.vendor && ` · ${m.vendor}`}
                    {m.cause && ` · cause: ${m.cause}`}
                    {u.financeVisible && d.repairCosts.find((c) => c.event_id === m.id)?.cost && ` · ${fmtRs(d.repairCosts.find((c) => c.event_id === m.id)?.cost)}`}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No repairs or services.</Empty>
            )}
          </Section>

          <Section title="Incidents (damage, loss, theft, found)">
            {d.incidents.length ? (
              <ul className="flex flex-col gap-2" data-testid="incidents">
                {d.incidents.map((i) => (
                  <li key={i.id}>
                    <b>{i.type}</b> ×{i.quantity} <Badge v={i.status} /> — {i.description}
                    {!i.history_known && <Flag>history unknown</Flag>}
                    {i.last_seen_place && ` · last seen ${i.last_seen_place}`}
                    {i.last_seen_at_text ? ` (${i.last_seen_at_text})` : i.last_seen_at ? ` (${fmtDate(i.last_seen_at)})` : ""}
                    {i.responsible_name && ` · responsible ${i.responsible_name}`}
                    {i.last_known_holder_name && ` · last holder ${i.last_known_holder_name}`}
                    {i.resolution && ` · ${i.resolution}`} <Link href={`/lost#${i.id}`}>manage</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No incidents.</Empty>
            )}
          </Section>

          {d.wishlist.length > 0 && (
            <Section
              title={
                <>
                  To-buy lines <Phase n={2} />
                </>
              }
            >
              <ul data-testid="item-tobuy">
                {d.wishlist.map((w) => (
                  <li key={w.id}>
                    <Link href={`/to-buy/${w.id}`}>{w.item_description}</Link> <Badge v={w.status} /> {w.priority} · {w.replaces_or_adds}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Photos" id="photos">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="photo-history">
              {d.photos
                .filter((p) => p.upload_state !== "legacy" || p.link_kind !== "text")
                .map((p) => (
                  <div key={p.id} className="text-xs">
                    {p.upload_state === "legacy" ? <LegacyPhoto p={p} small /> : <Thumb id={p.id} alt={p.kind} size={96} />}
                    <div>
                      <b>{p.kind}</b> {p.id === it.latest_photo_id ? "· latest" : ""}
                      {p.id === it.stock_image_photo_id ? "· stock" : ""}
                    </div>
                    <div className="muted">
                      {fmtDate(p.taken_at)} {p.upload_state === "failed" || p.upload_state === "pending" ? <Flag tone="bad">{p.upload_state}</Flag> : null}
                    </div>
                    {can.uploadPhotos(u) &&
                      p.id !== it.latest_photo_id &&
                      ["Check-in", "Latest", "Audit", "Check-out", "Damage"].includes(p.kind) &&
                      p.upload_state !== "legacy" && (
                        <ActionForm action={A.promotePhoto}>
                          <input type="hidden" name="photo_id" value={p.id} />
                          <input type="hidden" name="item_id" value={it.id} />
                          <Submit className="btn btn-sm btn-secondary mt-1">Make latest</Submit>
                        </ActionForm>
                      )}
                    {can.editItems(u) && p.kind === "Stock" && p.id !== it.stock_image_photo_id && p.upload_state !== "legacy" && (
                      <ActionForm action={A.makeStock}>
                        <input type="hidden" name="photo_id" value={p.id} />
                        <input type="hidden" name="item_id" value={it.id} />
                        <Submit className="btn btn-sm btn-secondary mt-1">Use as stock</Submit>
                      </ActionForm>
                    )}
                  </div>
                ))}
            </div>
            {can.uploadPhotos(u) && (
              <ActionForm action={A.attachPhotos} className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="item_id" value={it.id} />
                <input type="hidden" name="kind" value="Latest" />
                <PhotoCapture itemId={it.id} kind="Latest" label="Add a latest photo" />
                <Submit className="btn btn-secondary">Save as latest photo</Submit>
              </ActionForm>
            )}
            {can.editItems(u) && (
              <ActionForm action={A.attachPhotos} className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="item_id" value={it.id} />
                <input type="hidden" name="kind" value="Stock" />
                <PhotoCapture
                  itemId={it.id}
                  kind="Stock"
                  label={stock?.link_kind === "folder" ? "Stock link is a Drive folder — add the stock image (FR-PHO-007)" : "Replace stock image"}
                />
                <Submit className="btn btn-secondary">Save stock image</Submit>
              </ActionForm>
            )}
          </Section>

          <Section
            title={
              <>
                Timeline <Phase n={2} />
              </>
            }
          >
            {timeline.length ? (
              <ol className="flex flex-col gap-1.5" data-testid="timeline">
                {timeline.map((t, i) => (
                  <li key={i} className="text-sm">
                    <span className="muted">{fmtDateTime(t.at)}</span> · <span className="badge">{t.kind}</span> {t.text}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No history yet.</Empty>
            )}
          </Section>

          {can.itemAudit(u) && (
            <Section title="Audit history (changes)">
              {d.audit.length ? (
                <div className="overflow-x-auto">
                  <table className="tbl text-sm" data-testid="item-audit">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Who</th>
                        <th>Action</th>
                        <th>Change</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.audit.map((a) => (
                        <tr key={a.id}>
                          <td>{fmtDateTime(a.at)}</td>
                          <td>{a.actor_label}</td>
                          <td>
                            {a.action} {a.table_name}
                          </td>
                          <td>
                            <code className="text-xs break-all">
                              {a.before_json ? JSON.stringify(a.before_json).slice(0, 160) : ""} → {a.after_json ? JSON.stringify(a.after_json).slice(0, 160) : ""}
                            </code>
                            {a.reason ? <div>Reason: {a.reason}</div> : null}
                          </td>
                          <td>{a.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No changes recorded.</Empty>
              )}
            </Section>
          )}
        </div>

        <aside className="no-print">
          {u.financeVisible && (
            <Section title="Purchase details">
              {d.fin ? (
                <KV
                  rows={[
                    ["Purchase date", fmtDate(d.fin.purchase_date)],
                    ["Vendor", d.fin.vendor],
                    ["Order", d.fin.order_ref],
                    [
                      "Price",
                      <span key="p" data-testid="price">
                        {fmtRs(d.fin.purchase_price)}
                      </span>,
                    ],
                    ["Warranty until", fmtDate(d.fin.warranty_until)],
                    ["Note", d.fin.price_note],
                  ]}
                />
              ) : (
                <Empty>No purchase details.</Empty>
              )}
            </Section>
          )}

          {d.reservations.length > 0 && (
            <Section title="Reservations">
              <ul>
                {d.reservations.map((r) => (
                  <li key={r.id}>
                    {r.shoot}: {r.person_name}, {fmtDateTime(r.starts_at)} → {fmtDateTime(r.ends_at)}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {can.checkoutSelf(u) && it.is_active && (
            <Section
              title={
                <>
                  Reserve for a shoot <Phase n={2} />
                </>
              }
            >
              <ActionForm action={A.reserve} className="flex flex-col gap-2" resetOnSuccess>
                <input type="hidden" name="item_id" value={it.id} />
                <label className="field">
                  <span>Shoot</span>
                  <input name="shoot" className="input" required />
                </label>
                {can.checkoutOthers(u) && (
                  <label className="field">
                    <span>For</span>
                    <select name="person_id" className="input" defaultValue={u.personId}>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>From</span>
                  <input name="starts_at" type="datetime-local" className="input" required defaultValue={toIstInput(new Date(Date.now() + 86400000))} />
                </label>
                <label className="field">
                  <span>To</span>
                  <input name="ends_at" type="datetime-local" className="input" required defaultValue={toIstInput(new Date(Date.now() + 2 * 86400000))} />
                </label>
                <Submit className="btn btn-secondary">Reserve</Submit>
              </ActionForm>
            </Section>
          )}

          {can.report(u) && (
            <Section title="Report issue" id="report">
              <ActionForm action={A.reportIssue} className="flex flex-col gap-2">
                <input type="hidden" name="item_id" value={it.id} />
                <label className="field">
                  <span>Type</span>
                  <select name="type" className="input">
                    <option>Damage</option>
                    <option>Loss</option>
                    <option>Theft</option>
                  </select>
                </label>
                <label className="field">
                  <span>What happened</span>
                  <textarea name="description" className="input" required rows={3} />
                </label>
                {it.quantity_mode === "Counted" && (
                  <label className="field">
                    <span>Quantity affected</span>
                    <input name="quantity" type="number" min={1} defaultValue={1} className="input" />
                  </label>
                )}
                <label className="field">
                  <span>For loss/theft, mark item as</span>
                  <select name="mark" className="input">
                    <option value="Missing">Missing (being searched)</option>
                    {can.override(u) && <option value="Lost">Lost (confirmed)</option>}
                    <option value="">Do not change status</option>
                  </select>
                </label>
                <label className="field">
                  <span>Last seen place</span>
                  <input name="last_seen_place" className="input" />
                </label>
                <label className="field">
                  <span>Last seen date</span>
                  <input name="last_seen_at" type="date" className="input" />
                </label>
                <label className="field">
                  <span>Person responsible (if known)</span>
                  <select name="responsible_person_id" className="input">
                    <option value="">Unknown</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="history_unknown" /> How and when is unknown
                </label>
                <PhotoCapture itemId={it.id} kind="Damage" label="Damage photos" />
                <Submit>Report</Submit>
              </ActionForm>
            </Section>
          )}

          {lostOrMissing && can.report(u) && (
            <Section title="Mark as found" id="found">
              <ActionForm action={A.markFound} className="flex flex-col gap-2">
                <input type="hidden" name="item_id" value={it.id} />
                <label className="field">
                  <span>Where was it found?</span>
                  <input name="place" className="input" required />
                </label>
                {it.quantity_mode === "Counted" && (
                  <label className="field">
                    <span>How many</span>
                    <input name="quantity" type="number" min={1} defaultValue={1} className="input" />
                  </label>
                )}
                <label className="field">
                  <span>Put it at</span>
                  <select name="location_id" className="input">
                    {lk.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Condition</span>
                  <select name="condition" className="input">
                    {lk.conditions.map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <Submit>Confirm found</Submit>
              </ActionForm>
            </Section>
          )}

          {can.repairs(u) && (
            <Section title="Open repair / service" id="repair">
              <ActionForm action={A.openRepair} className="flex flex-col gap-2" resetOnSuccess>
                <input type="hidden" name="item_id" value={it.id} />
                <label className="field">
                  <span>Type</span>
                  <select name="type" className="input">
                    {["Repair", "Service", "Cleaning", "Calibration", "Firmware"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>State</span>
                  <select name="state" className="input">
                    {["Reported", "Sent for repair", "In repair"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Issue</span>
                  <textarea name="issue_description" className="input" required rows={2} />
                </label>
                <label className="field">
                  <span>Cause (if known)</span>
                  <input name="cause" className="input" />
                </label>
                <label className="field">
                  <span>Vendor</span>
                  <input name="vendor" className="input" />
                </label>
                <label className="field">
                  <span>Expected back</span>
                  <input name="expected_back" type="date" className="input" />
                </label>
                {it.quantity_mode === "Counted" && (
                  <label className="field">
                    <span>Units</span>
                    <input name="quantity" type="number" min={1} defaultValue={1} className="input" />
                  </label>
                )}
                {u.financeVisible && (
                  <label className="field">
                    <span>Cost (Rs)</span>
                    <input name="cost" type="number" step="0.01" className="input" />
                  </label>
                )}
                <Submit>Open</Submit>
              </ActionForm>
            </Section>
          )}

          {can.editItems(u) && it.is_active && it.quantity_mode === "Counted" && (
            <Section title="Correct stock" id="adjust">
              <ActionForm action={A.adjustStock} className="flex flex-col gap-2">
                <input type="hidden" name="item_id" value={it.id} />
                <p className="muted text-sm">Units on loans are not edited here. Set the non-loan holdings; stock becomes their total plus units on loan.</p>
                {[...d.holdings.filter((h) => !h.loan_line_id), {}, {}].map((h: Record<string, unknown>, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_8rem_5rem] gap-1">
                    <select
                      name="h_holder"
                      className="input"
                      defaultValue={h.holder_person_id ? `p:${h.holder_person_id}` : h.holder_location_id ? `l:${h.holder_location_id}` : ""}
                    >
                      <option value="">(none)</option>
                      {holderOpts.map((o) => (
                        <option key={o.v} value={o.v}>
                          {o.n}
                        </option>
                      ))}
                    </select>
                    <select name="h_status" className="input" defaultValue={(h.status as string) ?? "Available"}>
                      {["Available", "In repair", "Missing", "Lost"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <input name="h_qty" type="number" min={0} className="input" defaultValue={(h.quantity as number) ?? ""} />
                  </div>
                ))}
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="stock_to_verify" defaultChecked={it.stock_to_verify} /> Still to verify
                </label>
                <label className="field">
                  <span>Reason</span>
                  <input name="reason" className="input" required />
                </label>
                <Submit>Save stock</Submit>
              </ActionForm>
            </Section>
          )}

          {can.editItems(u) && it.is_active && it.quantity_mode === "Single" && it.status === "Available" && (
            <Section title="Change custodian (no loan)">
              <ActionForm action={A.setCustodian} className="flex flex-col gap-2">
                <input type="hidden" name="item_id" value={it.id} />
                <select name="holder" className="input">
                  {holderOpts.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.n}
                    </option>
                  ))}
                </select>
                <label className="field">
                  <span>Reason</span>
                  <input name="reason" className="input" required />
                </label>
                <Submit className="btn btn-secondary">Save</Submit>
              </ActionForm>
            </Section>
          )}

          {can.editItems(u) && it.is_active && it.quantity_mode === "Counted" && splitEnabled && (
            <Section
              title={
                <>
                  Split into tagged units <Phase n={2} />
                </>
              }
            >
              <p className="muted text-sm">
                Creates {it.id}-01, -02 … one per unit (suffix format proposed, pending Naveen&apos;s approval). History stays on {it.id}.
              </p>
              <ActionForm action={A.splitItem} className="flex flex-col gap-2">
                <input type="hidden" name="item_id" value={it.id} />
                <label className="field">
                  <span>Reason</span>
                  <input name="reason" className="input" required />
                </label>
                <Submit className="btn btn-secondary" confirm={`Split ${it.id} into individual units?`}>
                  Split
                </Submit>
              </ActionForm>
            </Section>
          )}

          {(can.retireDirect(u) || can.proposeRetire(u)) && it.is_active && (
            <Section title={can.retireDirect(u) ? "Retire, sell or write off" : "Propose retire, sale or write-off"}>
              {d.pendingRetirement ? (
                <div>
                  <p>
                    Pending: <b>{d.pendingRetirement.kind}</b> — {d.pendingRetirement.reason}
                  </p>
                  {can.retireDirect(u) && (
                    <ActionForm action={A.decideRetire} className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="request_id" value={d.pendingRetirement.id} />
                      <input type="hidden" name="item_id" value={it.id} />
                      <input name="comment" className="input" placeholder="Comment" />
                      <div className="flex gap-2">
                        <Submit name="decision" value="approve">
                          Approve
                        </Submit>
                        <Submit name="decision" value="reject" className="btn btn-secondary">
                          Reject
                        </Submit>
                      </div>
                    </ActionForm>
                  )}
                </div>
              ) : (
                <ActionForm action={A.requestRetire} className="flex flex-col gap-2">
                  <input type="hidden" name="item_id" value={it.id} />
                  <select name="kind" className="input">
                    <option>Retired</option>
                    <option>Sold</option>
                    <option>Written off</option>
                  </select>
                  <label className="field">
                    <span>Reason</span>
                    <input name="reason" className="input" required />
                  </label>
                  <Submit className="btn btn-secondary">{can.retireDirect(u) ? "Retire now" : "Send for approval"}</Submit>
                </ActionForm>
              )}
            </Section>
          )}
          {can.deleteItem(u) && (
            <Section title="Delete (created in error)">
              <p className="muted text-sm">Only for records created by mistake with no history. Otherwise retire.</p>
              <ActionForm action={A.deleteItem} className="flex flex-col gap-2">
                <input type="hidden" name="item_id" value={it.id} />
                <label className="field">
                  <span>Reason</span>
                  <input name="reason" className="input" required />
                </label>
                <Submit className="btn btn-danger" confirm={`Delete ${it.id} permanently? The ID will never be reused.`}>
                  Delete record
                </Submit>
              </ActionForm>
            </Section>
          )}
          {d.raw && (
            <Section title="Original sheet values">
              <pre className="overflow-x-auto text-xs whitespace-pre-wrap">{JSON.stringify(d.raw.legacy_raw, null, 1)}</pre>
            </Section>
          )}
        </aside>
      </div>
    </>
  );
}

function LegacyPhoto({ p, small }: { p: { original_url: string | null; link_kind: string; legacy_text: string | null }; small?: boolean }) {
  if (p.link_kind === "text") return <p className="muted text-sm">“{p.legacy_text}”</p>;
  return (
    <a
      href={p.original_url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className={`flex ${small ? "h-24 w-24" : "h-[150px] w-[150px]"} items-center justify-center rounded-md border border-dashed border-[var(--color-line)] p-2 text-center text-sm`}
    >
      {p.link_kind === "folder" ? "Drive folder link — pick a file" : "Drive file (open)"}
    </a>
  );
}
