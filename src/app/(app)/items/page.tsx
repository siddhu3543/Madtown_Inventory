import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { listItems, lookups, VIEWS, type ItemFilter } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Badge, Cond, Flag } from "@/components/ui";
import { Thumb } from "@/components/Thumb";
import { LiveSearch } from "@/components/LiveSearch";
import { ActionForm, Submit } from "@/components/ActionForm";
import { saveView, deleteView } from "./actions";

export const metadata = { title: "Items" };
type SP = Record<string, string | undefined>;

/** SCR-04: search, filters (Type, status, condition, holder, owner, to verify), saved views, thumbnails. */
export default async function Items({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const f: ItemFilter = {
    q: sp.q,
    type: sp.type,
    status: sp.status,
    condition: sp.condition,
    holder: sp.holder,
    owner: sp.owner,
    view: sp.view,
    subtype: sp.subtype,
    includeRetired: sp.retired === "1",
  };
  const t0 = Date.now();
  const [rows, lk, saved] = await Promise.all([
    listItems(u, f),
    lookups(u),
    withUser(u.id, async (c) => (await c.query("select * from saved_views where user_id = auth.uid() order by name")).rows),
  ]);
  const ms = Date.now() - t0;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const sel = (name: string, opts: string[], label: string) => (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={sp[name] ?? ""} className="input">
        <option value="">Any</option>
        {opts.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <PageHeader
        title="Items"
        sub={
          <span data-testid="result-count">
            {rows.length} item(s) · {ms} ms
          </span>
        }
        actions={
          <>
            {can.editItems(u) && (
              <Link href="/items/new" className="btn btn-primary">
                Add item
              </Link>
            )}
            <a href={`/api/export/inventory.csv?${qs}`} className="btn btn-secondary" data-testid="export-csv">
              Export CSV
            </a>
            {can.labels(u) && (
              <Link href={`/labels?${qs}`} className="btn btn-secondary">
                Labels for these
              </Link>
            )}
          </>
        }
      />
      <div className="card mb-3 p-3">
        <Suspense>
          <LiveSearch autoFocus />
        </Suspense>
      </div>
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Saved views">
        <Link href="/items" className={`btn btn-sm ${!sp.view ? "btn-primary" : "btn-secondary"}`}>
          All active
        </Link>
        {Object.entries(VIEWS).map(([k, v]) => (
          <Link key={k} href={`/items?view=${k}`} className={`btn btn-sm ${sp.view === k ? "btn-primary" : "btn-secondary"}`} data-testid={`view-${k}`}>
            {v.label}
          </Link>
        ))}
        {saved.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <Link href={`/items?${new URLSearchParams(s.query).toString()}`} className="btn btn-sm btn-secondary">
              ★ {s.name}
            </Link>
            <ActionForm action={deleteView}>
              <input type="hidden" name="id" value={s.id} />
              <Submit className="btn btn-sm btn-secondary">×</Submit>
            </ActionForm>
          </span>
        ))}
      </div>
      <details className="card mb-3 p-3">
        <summary className="cursor-pointer font-semibold">Filters and saved views</summary>
        <form className="mt-3 grid gap-3 sm:grid-cols-3" method="get">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          {sp.view && <input type="hidden" name="view" value={sp.view} />}
          {sel(
            "type",
            lk.types.map((t) => t.name),
            "Type",
          )}
          {sel(
            "subtype",
            lk.subtypes.map((t) => t.name),
            "Subtype",
          )}
          {sel("status", ["Available", "Checked out", "Reserved", "In repair", "Missing", "Lost", "Retired"], "Status")}
          {sel("condition", [...lk.conditions.map((c) => c.name), "(blank)"], "Condition")}
          {sel(
            "holder",
            lk.holders.map((h) => h.name),
            "Holder",
          )}
          {sel(
            "owner",
            lk.owners.map((o) => o.name),
            "Owner",
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="retired" value="1" defaultChecked={sp.retired === "1"} /> Include retired
          </label>
          <button className="btn btn-primary">Apply</button>
        </form>
        <ActionForm action={saveView} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="query" value={qs} />
          <label className="field">
            <span>Save current filters as</span>
            <input name="name" className="input" required />
          </label>
          <Submit className="btn btn-secondary">Save view</Submit>
        </ActionForm>
      </details>
      <ul className="flex flex-col gap-2" data-testid="item-list">
        {rows.map((r) => (
          <li key={r.id} className="card flex gap-3 p-3" data-testid="item-row" data-item-id={r.id}>
            <Thumb id={r.thumb_photo_id} alt={r.name} />
            <div className="min-w-0 flex-1">
              <Link href={`/items/${r.id}`} className="block text-lg font-bold">
                {r.id} · {r.name}
              </Link>
              <div className="muted text-sm">
                {[r.type, r.subtype, r.model_number].filter(Boolean).join(" · ")}
                {r.parent_item_id ? ` · part of ${r.parent_item_id}` : ""}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge v={r.display_status} /> <Cond v={r.condition} />
                {r.quantity_mode === "Counted" && (
                  <span className="badge">
                    {r.available_qty}/{r.stock} available
                  </span>
                )}
                {!r.owned_by_madtown && <Flag>Owner: {r.owner_name}</Flag>}
                {(r.to_verify || r.stock_to_verify || r.model_tbd) && (
                  <Flag>To verify{r.to_verify_reason ? `: ${r.to_verify_reason}` : r.stock_to_verify_reason ? `: ${r.stock_to_verify_reason}` : ""}</Flag>
                )}
                {r.flag_missing_parts && <Flag tone="bad">Missing parts</Flag>}
                {r.flag_overdue && <Flag tone="bad">Overdue</Flag>}
              </div>
              <div className="mt-1 text-sm">
                Holder: <b>{r.quantity_mode === "Counted" ? (r.holder_names ?? "—") : (r.holder_label ?? "—")}</b>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="muted">No items match. Try the ID (e.g. 101 or MTMH_101) or part of the name.</p>}
    </>
  );
}
