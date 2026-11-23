import Link from "next/link";
import { Suspense } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Download, Plus, SlidersHorizontal, Tag, X, PackageSearch } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listItems, lookups, VIEWS, type ItemFilter, type ItemRow } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Badge, Cond, Flag, Empty, Pager } from "@/components/ui";
import { Thumb } from "@/components/Thumb";
import { LiveSearch } from "@/components/LiveSearch";
import { ActionForm, Submit } from "@/components/ActionForm";
import { saveView, deleteView } from "./actions";

export const metadata = { title: "Items" };
type SP = Record<string, string | undefined>;
const PAGE_SIZE = 50;

const SORTS: Record<string, (a: ItemRow, b: ItemRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  type: (a, b) => (a.type ?? "").localeCompare(b.type ?? "") || a.name.localeCompare(b.name),
  status: (a, b) => a.display_status.localeCompare(b.display_status),
  condition: (a, b) => (a.condition ?? "~").localeCompare(b.condition ?? "~"),
  holder: (a, b) => (a.holder_label ?? "~").localeCompare(b.holder_label ?? "~"),
  owner: (a, b) => a.owner_name.localeCompare(b.owner_name),
};

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
  const [all, lk, saved] = await Promise.all([
    listItems(u, f),
    lookups(u),
    withUser(u.id, async (c) => (await c.query("select * from saved_views where user_id = auth.uid() order by name")).rows),
  ]);
  // sorting and paging happen in memory over the already-filtered list (the data model has no server paging)
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : "";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const rows = sort ? [...all].sort(SORTS[sort]) : all;
  if (sort && dir === "desc") rows.reverse();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const keep = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return `/items${s ? `?${s}` : ""}`;
  };
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page" && k !== "sort" && k !== "dir") as [string, string][]).toString();
  const FILTER_KEYS = ["type", "subtype", "status", "condition", "holder", "owner"] as const;
  const active = FILTER_KEYS.filter((k) => sp[k]);
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
  const th = (key: string, label: string) => {
    const on = sort === key;
    const Icon = !on ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <Link
        href={keep({ sort: key, dir: on && dir === "asc" ? "desc" : "asc", page: undefined })}
        className="inline-flex items-center gap-1 text-inherit no-underline hover:text-[var(--color-ink)] hover:no-underline"
        aria-label={`Sort by ${label}`}
      >
        {label} <Icon size={12} aria-hidden className={on ? "" : "opacity-40"} />
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Items"
        sub={<span data-testid="result-count">{rows.length} item(s)</span>}
        actions={
          <>
            <a href={`/api/export/inventory.csv?${qs}`} className="btn btn-secondary" data-testid="export-csv">
              <Download size={16} aria-hidden /> Export CSV
            </a>
            {can.labels(u) && (
              <Link href={`/labels?${qs}`} className="btn btn-secondary">
                <Tag size={16} aria-hidden /> Labels for these
              </Link>
            )}
            {can.editItems(u) && (
              <Link href="/items/new" className="btn btn-primary">
                <Plus size={18} aria-hidden /> Add item
              </Link>
            )}
          </>
        }
      />

      <div className="card mb-4 p-3 sm:p-4">
        <Suspense>
          <LiveSearch autoFocus />
        </Suspense>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1" aria-label="Saved views">
          <Link href="/items" className="chip" aria-current={!sp.view ? "true" : undefined}>
            All active
          </Link>
          {Object.entries(VIEWS).map(([k, v]) => (
            <Link key={k} href={`/items?view=${k}`} className="chip" aria-current={sp.view === k ? "true" : undefined} data-testid={`view-${k}`}>
              {v.label}
            </Link>
          ))}
          {saved.map((s) => (
            <span key={s.id} className="chip !gap-0 !pr-0">
              <Link href={`/items?${new URLSearchParams(s.query).toString()}`} className="inline-flex items-center gap-1 text-inherit no-underline">
                <Bookmark size={13} aria-hidden /> {s.name}
              </Link>
              <ActionForm action={deleteView}>
                <input type="hidden" name="id" value={s.id} />
                <Submit className="btn btn-ghost btn-sm !min-h-7 !w-7 !p-0" confirm={`Delete the saved view “${s.name}”?`}>
                  <X size={13} aria-label={`Delete saved view ${s.name}`} />
                </Submit>
              </ActionForm>
            </span>
          ))}
        </div>
        <details className="group mt-2 border-t border-[var(--color-line)] pt-3" open={active.length > 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal size={16} aria-hidden /> Filters and saved views
            {active.length > 0 && <span className="rounded-full bg-[var(--color-brand-soft)] px-2 text-xs text-[var(--color-brand)]">{active.length} active</span>}
          </summary>
          <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" method="get">
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
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="retired" value="1" defaultChecked={sp.retired === "1"} /> Include retired
            </label>
            <div className="flex items-end gap-2 sm:col-span-1 lg:col-span-2 lg:justify-end">
              {active.length > 0 && (
                <Link
                  href={keep({
                    type: undefined,
                    subtype: undefined,
                    status: undefined,
                    condition: undefined,
                    holder: undefined,
                    owner: undefined,
                    retired: undefined,
                    page: undefined,
                  })}
                  className="btn btn-ghost"
                >
                  Clear filters
                </Link>
              )}
              <button className="btn btn-primary">Apply filters</button>
            </div>
          </form>
          <ActionForm action={saveView} className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--color-line)] pt-4">
            <input type="hidden" name="query" value={qs} />
            <label className="field min-w-56 flex-1 sm:flex-none">
              <span>Save current filters as</span>
              <input name="name" className="input" required placeholder="e.g. Cameras out this week" />
            </label>
            <Submit className="btn btn-secondary">
              <Bookmark size={16} aria-hidden /> Save view
            </Submit>
          </ActionForm>
        </details>
        {active.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {active.map((k) => (
              <Link key={k} href={keep({ [k]: undefined, page: undefined })} className="chip" aria-label={`Remove filter ${k}`}>
                <span className="muted capitalize">{k}:</span> {sp[k]} <X size={12} aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <Empty icon={PackageSearch}>No items match. Try the ID (e.g. 101 or MTMH_101) or part of the name.</Empty>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="tbl block md:table" data-testid="item-list">
            <thead className="hidden md:table-header-group">
              <tr>
                <th>{th("name", "Item")}</th>
                <th>{th("status", "Status")}</th>
                <th>{th("condition", "Condition")}</th>
                <th className="text-right">Qty</th>
                <th>{th("holder", "Holder")}</th>
                <th>{th("owner", "Owner")}</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {shown.map((r) => {
                const verify = r.to_verify || r.stock_to_verify || r.model_tbd;
                return (
                  <tr
                    key={r.id}
                    className="grid grid-cols-1 gap-x-3 gap-y-1.5 border-b border-[var(--color-line)] p-3 md:table-row md:p-0"
                    data-testid="item-row"
                    data-item-id={r.id}
                  >
                    <td className="col-span-2 !border-0 !p-0 md:col-span-1 md:!border-b md:!px-3 md:!py-3 md:align-middle">
                      <div className="flex items-center gap-3">
                        <Thumb id={r.thumb_photo_id} alt={r.name} size={48} />
                        <ItemCell r={r} />
                      </div>
                    </td>
                    <td className="col-span-2 !border-0 !p-0 md:col-span-1 md:!border-b md:!px-3 md:!py-3 md:align-middle">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge v={r.display_status} />
                        <span className="md:hidden">
                          <Cond v={r.condition} />
                        </span>
                        {r.flag_overdue && <Flag tone="bad">Overdue</Flag>}
                        {r.flag_missing_parts && <Flag tone="bad">Missing parts</Flag>}
                        {verify && <Flag>To verify{r.to_verify_reason ? `: ${r.to_verify_reason}` : r.stock_to_verify_reason ? `: ${r.stock_to_verify_reason}` : ""}</Flag>}
                      </div>
                    </td>
                    <td className="hidden !border-b md:table-cell md:!px-3 md:!py-3 md:align-middle">
                      <Cond v={r.condition} />
                    </td>
                    <td className="col-span-2 !border-0 !p-0 text-sm md:col-span-1 md:!border-b md:!px-3 md:!py-3 md:text-right md:align-middle md:tabular-nums">
                      {r.quantity_mode === "Counted" ? (
                        <span className="badge badge-plain whitespace-nowrap" style={{ color: "var(--color-ink)" }}>
                          {r.available_qty}/{r.stock} available
                        </span>
                      ) : (
                        <span className="muted hidden md:inline">1</span>
                      )}
                    </td>
                    <td className="col-span-2 !border-0 !p-0 text-sm md:col-span-1 md:!border-b md:!px-3 md:!py-3 md:align-middle md:text-[0.9rem]">
                      <span className="muted md:hidden">Holder: </span>
                      <b className="font-semibold md:font-medium">{r.quantity_mode === "Counted" ? (r.holder_names ?? "—") : (r.holder_label ?? "—")}</b>
                    </td>
                    <td className="col-span-2 !border-0 !p-0 text-sm md:col-span-1 md:!border-b md:!px-3 md:!py-3 md:align-middle md:text-[0.9rem]">
                      {r.owned_by_madtown ? <span className="muted hidden md:inline">Madtown</span> : <Flag>Owner: {r.owner_name}</Flag>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} href={(p) => keep({ page: String(p) })} />
    </>
  );
}

function ItemCell({ r }: { r: ItemRow }) {
  return (
    <div className="min-w-0">
      <Link href={`/items/${r.id}`} className="block font-semibold text-[var(--color-ink)] hover:text-[var(--color-brand)]">
        <span className="font-mono text-[0.8125em] font-medium text-[var(--color-muted)]">{r.id}</span> · {r.name}
      </Link>
      <div className="muted text-sm">
        {[r.type, r.subtype, r.model_number].filter(Boolean).join(" · ")}
        {r.parent_item_id ? ` · part of ${r.parent_item_id}` : ""}
      </div>
    </div>
  );
}
