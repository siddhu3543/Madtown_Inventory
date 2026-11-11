import "server-only";
import { withUser, callWorkflow } from "../db";
import type { CurrentUser } from "../auth";

/** FR-CAT-011 saved views. Each maps to a boolean flag column of items_v; dashboard uses the same flags (AC-RPT-01). */
export const VIEWS = {
  out_now: { label: "Out now", flag: "flag_out_now" },
  overdue: { label: "Overdue", flag: "flag_overdue" },
  in_repair: { label: "In repair", flag: "flag_in_repair" },
  lost: { label: "Lost", flag: "flag_lost" },
  missing: { label: "Missing", flag: "flag_missing" },
  bad_condition: { label: "Bad condition", flag: "flag_bad_condition" },
  owned_by_others: { label: "Owned by others", flag: "flag_owned_by_others" },
  missing_photos: { label: "Missing photos", flag: "flag_missing_photos" },
  to_verify: { label: "To verify", flag: "flag_to_verify" },
  missing_parts: { label: "Missing parts", flag: "flag_missing_parts" },
  retired: { label: "Retired", flag: "(status = 'Retired')" },
} as const;
export type ViewKey = keyof typeof VIEWS;

export type ItemFilter = {
  q?: string;
  type?: string;
  subtype?: string;
  status?: string;
  condition?: string;
  holder?: string;
  owner?: string;
  view?: string;
  includeRetired?: boolean;
  limit?: number;
  ids?: string[];
};

export type ItemRow = {
  id: string;
  name: string;
  model_number: string | null;
  type: string;
  subtype: string | null;
  quantity_mode: string;
  stock: number;
  status: string;
  display_status: string;
  condition: string | null;
  owner_name: string;
  owned_by_madtown: boolean;
  holder_label: string | null;
  available_qty: number;
  out_qty: number;
  lost_qty: number;
  missing_qty: number;
  in_repair_qty: number;
  to_verify: boolean;
  to_verify_reason: string | null;
  stock_to_verify: boolean;
  stock_to_verify_reason: string | null;
  model_tbd: boolean;
  flag_missing_photos: boolean;
  flag_overdue: boolean;
  flag_missing_parts: boolean;
  stock_image_photo_id: string | null;
  latest_photo_id: string | null;
  thumb_photo_id: string | null;
  parent_item_id: string | null;
  label_target: string;
  label_note: string | null;
  brand: string | null;
  notes: string | null;
  holder_names: string | null;
  is_active: boolean;
};

function buildWhere(f: ItemFilter, params: unknown[]) {
  const w: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const view = f.view && f.view in VIEWS ? (f.view as ViewKey) : null;
  if (view) w.push(VIEWS[view].flag);
  if (!f.includeRetired && view !== "retired" && !f.q) w.push("is_active");
  if (f.q) {
    // FR-CAT-010: ID, name, model, type, holder, status, condition
    const raw = f.q.trim();
    const idLike = raw
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/^(\d{3})$/, "MTMH_$1")
      .replace(/^MTMH(\d)/, "MTMH_$1");
    const ph = p(`%${raw}%`);
    w.push(`(v.id ilike ${p(`%${idLike}%`)} or v.name ilike ${ph} or v.model_number ilike ${ph} or v.type ilike ${ph} or v.brand ilike ${ph}
           or v.holder_label ilike ${ph} or v.status ilike ${ph} or v.condition ilike ${ph} or coalesce(v.subtype,'') ilike ${ph}
           or exists (select 1 from item_holdings h join people hp on hp.id = h.holder_person_id where h.item_id = v.id and hp.name ilike ${ph})
           or exists (select 1 from items par where par.id = v.parent_item_id and (par.name ilike ${ph} or par.model_number ilike ${ph})))`);
  }
  if (f.type) w.push(`v.type = ${p(f.type)}`);
  if (f.subtype) w.push(`v.subtype = ${p(f.subtype)}`);
  if (f.status) w.push(`v.display_status = ${p(f.status)}`);
  if (f.condition) w.push(f.condition === "(blank)" ? "v.condition is null" : `v.condition = ${p(f.condition)}`);
  if (f.owner) w.push(`v.owner_name = ${p(f.owner)}`);
  if (f.holder) {
    const ph = p(f.holder);
    w.push(`(v.holder_label = ${ph} or exists (select 1 from item_holdings h left join people hp on hp.id = h.holder_person_id left join locations hl on hl.id = h.holder_location_id
             where h.item_id = v.id and h.quantity > 0 and coalesce(hp.name, hl.name) = ${ph}))`);
  }
  if (f.ids?.length) w.push(`v.id = any(${p(f.ids)})`);
  return w.length ? "where " + w.join(" and ") : "";
}

const LIST_SQL = (where: string, limit: string) => `
  select v.*, coalesce(v.latest_photo_id, v.stock_image_photo_id) as thumb_photo_id,
    (select string_agg(coalesce(hp.name, hl.name) || ' ' || h.quantity || case when h.status <> 'Available' then ' (' || h.status || ')' else '' end, ', ' order by h.status, coalesce(hp.name, hl.name))
       from item_holdings h left join people hp on hp.id = h.holder_person_id left join locations hl on hl.id = h.holder_location_id
      where h.item_id = v.id and h.quantity > 0) as holder_names
  from items_v v ${where}
  order by case when v.id ~ '^MTMH_[0-9]+' then (regexp_match(v.id, '^MTMH_([0-9]+)'))[1]::int end, v.id
  ${limit}`;

export async function listItems(u: CurrentUser, f: ItemFilter): Promise<ItemRow[]> {
  const params: unknown[] = [];
  const where = buildWhere(f, params);
  const limit = f.limit ? `limit ${Math.min(Math.max(1, f.limit | 0), 5000)}` : "";
  return withUser(u.id, async (c) => (await c.query(LIST_SQL(where, limit), params)).rows);
}

export async function dashboardCounts(u: CurrentUser) {
  return withUser(u.id, async (c) => {
    const r = await c.query(`
      select count(*) filter (where is_active) as active,
             count(*) filter (where flag_out_now) as out_now,
             count(*) filter (where flag_overdue) as overdue,
             count(*) filter (where flag_in_repair) as in_repair,
             count(*) filter (where flag_lost) as lost,
             count(*) filter (where flag_missing) as missing,
             count(*) filter (where flag_bad_condition and is_active) as bad_condition,
             count(*) filter (where flag_to_verify and is_active) as to_verify,
             count(*) filter (where flag_missing_photos and is_active) as missing_photos,
             count(*) filter (where flag_missing_parts) as missing_parts
        from items_v`);
    const s = await c.query(`select count(*)::int n from maintenance_schedules s
        left join items i on i.id = s.item_id
       where s.active and s.next_due <= (now() at time zone 'Asia/Kolkata')::date + coalesce((app.setting('upkeep_days_before') #>> '{}')::int, 7)
         and (s.item_id is null or i.status <> 'Retired')`);
    // "to-buy waiting for approval" = lines in status To buy (ready for the Owner's decision; To research lines are not yet ready)
    const w = await c.query(`select count(*)::int n from wishlist_items where status = 'To buy'`);
    const w2 = await c.query(`select count(*)::int n from wishlist_items where status in ('To research','To buy')`);
    const ev = await c.query(
      `select count(*)::int n from photos where upload_state in ('pending','failed') and kind in ('Check-out','Check-in','Damage','Invoice') and created_at < now() - interval '10 minutes'`,
    );
    const row = Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)]));
    return { ...row, due_for_service: s.rows[0].n, to_buy_awaiting: w.rows[0].n, to_buy_open: w2.rows[0].n, incomplete_evidence: ev.rows[0].n } as Record<string, number>;
  });
}

export async function getItemFull(u: CurrentUser, id: string) {
  return withUser(u.id, async (c) => {
    const q = async (sql: string, p: unknown[] = [id]) => (await c.query(sql, p)).rows;
    const item = (await q(`${LIST_SQL("where v.id = $1", "")}`))[0];
    if (!item) return null;
    const [parent] = item.parent_item_id ? await q("select id, name, status from items_v where id = $1", [item.parent_item_id]) : [null];
    const caseItem = item.case_item_id ? (await q("select id, name from items_v where id = $1", [item.case_item_id]))[0] : null;
    const children = await q("select id, name, status, display_status, type from items_v where parent_item_id = $1 order by id");
    const carried = await q("select id, name from items_v where case_item_id = $1 order by id");
    const kits = await q(`select k.id, k.name, ki.required, ki.quantity from kit_items ki join kits k on k.id = ki.kit_id where ki.item_id = $1 order by k.id`);
    const missingParts = await q(`select m.*, w.item_description as wishlist_description, w.status as wishlist_status from missing_parts m
                                   left join wishlist_items w on w.id = m.wishlist_id where m.item_id = $1 order by m.status, m.reported_at desc`);
    const detached = await q(`select d.*, p.name as holder_name from detached_accessories d join people p on p.id = d.holder_person_id
                               where d.item_id = $1 order by d.returned_at nulls first, d.since desc`);
    const holdings = await q(`select h.*, hp.name as person_name, hl.name as location_name from item_holdings h
                                left join people hp on hp.id = h.holder_person_id left join locations hl on hl.id = h.holder_location_id
                               where h.item_id = $1 and h.quantity > 0 order by h.status, coalesce(hp.name, hl.name)`);
    const loans = await q(`select l.*, ll.quantity, ll.qty_returned, ll.qty_lost, ll.qty_transferred, ll.active as line_active, p.name as borrower_name,
                                  (select count(*) from photos ph where ph.loan_id = l.id and ph.upload_state in ('pending','failed'))::int as pending_evidence
                             from loan_lines ll join loans l on l.id = ll.loan_id join people p on p.id = l.borrower_person_id
                            where ll.item_id = $1 order by coalesce(l.checked_out_at, l.created_at) desc limit 20`);
    const loanCount = (await q("select count(distinct loan_id)::int n from loan_lines where item_id = $1"))[0].n;
    const repairs = await q(`select m.*, (select json_agg(h order by h.at) from (select h.to_state, h.at, h.note, p.name as by_name from maintenance_state_history h
                               left join users u on u.id = h.by_user left join people p on p.id = u.person_id where h.event_id = m.id) h) as history
                              from maintenance_events m where m.item_id = $1 order by coalesce(m.event_date::timestamptz, m.reported_at) desc`);
    const incidents = await q(`select i.*, lk.name as last_known_holder_name, rp.name as responsible_name from incidents i
                                 left join people lk on lk.id = i.last_known_holder_person_id left join people rp on rp.id = i.responsible_person_id
                                where i.item_id = $1 order by i.reported_at desc`);
    const photos = await q(`select ph.*, p.name as taken_by_name from photos ph left join users u on u.id = ph.taken_by left join people p on p.id = u.person_id
                             where ph.item_id = $1 order by ph.taken_at desc`);
    const wishlist = await q(`select w.id, w.item_description, w.status, w.priority, w.replaces_or_adds from wishlist_related_items r
                               join wishlist_v w on w.id = r.wishlist_id where r.item_id = $1 order by w.status, w.priority`);
    const reservations = await q(`select r.*, p.name as person_name from reservations r join people p on p.id = r.person_id
                                   where r.item_id = $1 and r.status = 'Active' and r.ends_at > now() order by r.starts_at`);
    const audits = await q(
      `select al.*, a.scope_kind, a.scope_value, a.started_at from audit_lines al join audits a on a.id = al.audit_id where al.item_id = $1 order by al.scanned_at desc`,
    );
    const events = await q(`select e.*, p.name as person_name, bp.name as by_name from loan_events e left join people p on p.id = e.person_id
                             left join users u on u.id = e.by_user left join people bp on bp.id = u.person_id where e.item_id = $1 order by e.at desc, e.event`);
    const fin = u.financeVisible ? ((await q("select * from item_financials where item_id = $1"))[0] ?? null) : null;
    const repairCosts = u.financeVisible ? await q("select mc.* from maintenance_costs mc join maintenance_events m on m.id = mc.event_id where m.item_id = $1") : [];
    const raw = u.financeVisible || u.isDeveloper ? ((await q("select * from item_import_raw where item_id = $1"))[0] ?? null) : null;
    const audit = u.role === "Owner" || u.role === "Manager" ? await q("select * from app.item_audit($1) limit 200") : [];
    const pendingRetirement = (await q("select * from retirement_requests where item_id = $1 and status = 'Pending'"))[0] ?? null;
    return {
      item,
      parent,
      caseItem,
      children,
      carried,
      kits,
      missingParts,
      detached,
      holdings,
      loans,
      loanCount,
      repairs,
      incidents,
      photos,
      wishlist,
      reservations,
      audits,
      events,
      fin,
      repairCosts,
      raw,
      audit,
      pendingRetirement,
    };
  });
}
export type ItemFull = NonNullable<Awaited<ReturnType<typeof getItemFull>>>;

export async function itemIndex(u: CurrentUser) {
  return withUser(
    u.id,
    async (c) =>
      (await c.query(`select id, name, model_number, type, display_status as status, condition, holder_label, quantity_mode, available_qty from items_v order by id`)).rows,
  );
}

export async function createItem(u: CurrentUser, payload: Record<string, unknown>) {
  return withUser(u.id, (c) => callWorkflow<{ item_id: string }>(c, "create_item", payload));
}

const EDITABLE = [
  "name",
  "model_number",
  "model_tbd",
  "brand",
  "serial_number",
  "type",
  "subtype",
  "owner_person_id",
  "home_location_id",
  "parent_item_id",
  "case_item_id",
  "case_capacity_note",
  "needs_case",
  "label_target",
  "label_note",
  "notes",
  "to_verify",
  "to_verify_reason",
  "stock_to_verify_reason",
  "condition",
] as const;

export async function updateItem(u: CurrentUser, id: string, patch: Record<string, unknown>, fin?: Record<string, unknown> | null) {
  return withUser(u.id, async (c) => {
    const cols = EDITABLE.filter((k) => k in patch);
    if (cols.length) {
      const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const r = await c.query(`update items set ${sets} where id = $1`, [id, ...cols.map((k) => patch[k])]);
      if (r.rowCount === 0) throw new Error("NOT_FOUND: item not found or not editable");
    }
    if (fin && u.financeVisible) {
      await c.query(
        `insert into item_financials(item_id, purchase_date, vendor, order_ref, purchase_price, warranty_until, price_note)
                     values ($1,$2,$3,$4,$5,$6,$7)
                     on conflict (item_id) do update set purchase_date = excluded.purchase_date, vendor = excluded.vendor, order_ref = excluded.order_ref,
                       purchase_price = excluded.purchase_price, warranty_until = excluded.warranty_until, price_note = excluded.price_note`,
        [
          id,
          fin.purchase_date || null,
          fin.vendor || null,
          fin.order_ref || null,
          fin.purchase_price === "" || fin.purchase_price == null ? null : fin.purchase_price,
          fin.warranty_until || null,
          fin.price_note || null,
        ],
      );
    }
  });
}

export async function lookups(u: CurrentUser) {
  return withUser(u.id, async (c) => {
    const q = async (sql: string) => (await c.query(sql)).rows;
    return {
      types: await q("select * from item_types where status = 'Approved' order by sort, name"),
      proposedTypes: await q("select * from item_types where status = 'Proposed' order by name"),
      subtypes: await q("select * from item_subtypes where status = 'Approved' order by sort, name"),
      conditions: await q("select * from conditions where enabled order by rank desc"),
      people: await q(
        "select p.id, p.name, p.person_type, p.active, p.is_madtown, (u.id is not null) as has_login from people p left join users u on u.person_id = p.id and u.active order by p.is_madtown desc, p.name",
      ),
      locations: await q("select * from locations where active order by is_default_home desc, name"),
      holders:
        await q(`select distinct coalesce(hp.name, hl.name) as name from items i left join people hp on hp.id = i.holder_person_id left join locations hl on hl.id = i.holder_location_id where coalesce(hp.name, hl.name) is not null
                        union select distinct coalesce(hp.name, hl.name) from item_holdings h left join people hp on hp.id = h.holder_person_id left join locations hl on hl.id = h.holder_location_id where coalesce(hp.name, hl.name) is not null order by 1`),
      owners: await q("select distinct p.name from items i join people p on p.id = i.owner_person_id order by 1"),
    };
  });
}
export type Lookups = Awaited<ReturnType<typeof lookups>>;
