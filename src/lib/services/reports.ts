import "server-only";
import { withUser } from "../db";
import type { CurrentUser } from "../auth";
import { AppError } from "../errors";

/** FR-RPT-003: loans by person and by project for a date range */
export async function loansReport(u: CurrentUser, from: string, to: string) {
  return withUser(u.id, async (c) => {
    const p = [from, to];
    const byPerson = (
      await c.query(
        `
      select p.name, count(distinct l.id)::int loans, sum(ll.quantity)::int units,
             count(distinct l.id) filter (where l.status = 'Overdue')::int overdue,
             count(distinct l.id) filter (where l.condition_in is not null and app.condition_rank(l.condition_in) < app.condition_rank(l.condition_out))::int damaged
        from loans l join people p on p.id = l.borrower_person_id join loan_lines ll on ll.loan_id = l.id
       where coalesce(l.checked_out_at, l.created_at) >= $1::date and coalesce(l.checked_out_at, l.created_at) < $2::date + 1 and l.close_reason is distinct from 'Transferred'
       group by p.name order by loans desc, p.name`,
        p,
      )
    ).rows;
    const byProject = (
      await c.query(
        `
      select coalesce(nullif(l.purpose_or_project, ''), '(no project)') project, count(distinct l.id)::int loans, sum(ll.quantity)::int units,
             string_agg(distinct p.name, ', ') people
        from loans l join people p on p.id = l.borrower_person_id join loan_lines ll on ll.loan_id = l.id
       where coalesce(l.checked_out_at, l.created_at) >= $1::date and coalesce(l.checked_out_at, l.created_at) < $2::date + 1
       group by 1 order by loans desc`,
        p,
      )
    ).rows;
    return { byPerson, byProject };
  });
}

/** FR-RPT-004: frequency and cost per item and per vendor (cost only for finance viewers) */
export async function repairsReport(u: CurrentUser) {
  return withUser(u.id, async (c) => {
    const fin = u.financeVisible;
    const byItem = (
      await c.query(`
      select m.item_id, i.name, count(*)::int events, count(*) filter (where m.type = 'Repair')::int repairs
             ${fin ? ", coalesce(sum(mc.cost), 0) as cost" : ""}
        from maintenance_events m join items i on i.id = m.item_id ${fin ? "left join maintenance_costs mc on mc.event_id = m.id" : ""}
       group by m.item_id, i.name order by events desc, m.item_id`)
    ).rows;
    const byVendor = (
      await c.query(`
      select coalesce(m.vendor, '(unknown vendor)') vendor, count(*)::int events ${fin ? ", coalesce(sum(mc.cost), 0) as cost" : ""}
        from maintenance_events m ${fin ? "left join maintenance_costs mc on mc.event_id = m.id" : ""} group by 1 order by events desc`)
    ).rows;
    return { byItem, byVendor, costs: fin };
  });
}

/** FR-RPT-005: days out per item in the last 90 days; items never used */
export async function utilisation(u: CurrentUser) {
  return withUser(u.id, async (c) => {
    const rows = (
      await c.query(`
      with spans as (
        select ll.item_id, greatest(l.checked_out_at, now() - interval '90 days') s, least(coalesce(l.checked_in_at, now()), now()) e
          from loan_lines ll join loans l on l.id = ll.loan_id
         where l.checked_out_at is not null and coalesce(l.checked_in_at, now()) > now() - interval '90 days')
      select i.id, i.name, i.type, coalesce(round(sum(extract(epoch from (e - s))) / 86400.0, 1), 0)::float as days_out,
             (select count(*) from loan_lines x join loans lx on lx.id = x.loan_id where x.item_id = i.id and not lx.legacy)::int as loans_ever
        from items i left join spans sp on sp.item_id = i.id where i.status <> 'Retired'
       group by i.id order by days_out desc, i.id`)
    ).rows;
    return { rows, neverUsed: rows.filter((r) => r.loans_ever === 0) };
  });
}

/** FR-RPT-006 (Phase 3 Could, basic part built): Madtown-owned items at purchase price (FR-CAT-008, FR-LST-008, D-22) */
export async function assetValue(u: CurrentUser) {
  if (!u.financeVisible) throw new AppError("NOT_ALLOWED", "Asset value is restricted", 403);
  return withUser(u.id, async (c) => {
    const rows = (
      await c.query(`
      select v.id, v.name, v.type, v.status, v.owned_by_madtown, v.owner_name, v.quantity_mode, v.stock, v.lost_qty, f.purchase_price, f.purchase_date
        from items_v v left join item_financials f on f.item_id = v.id order by v.id`)
    ).rows;
    const counted = (r: (typeof rows)[number]) => r.owned_by_madtown && r.status !== "Retired" && r.status !== "Lost";
    const items = rows.filter((r) => counted(r) && r.status !== "Missing");
    const atRisk = rows.filter((r) => counted(r) && r.status === "Missing");
    const value = (rs: typeof rows) => rs.reduce((a, r) => a + (r.purchase_price ? Number(r.purchase_price) : 0), 0);
    return {
      items,
      atRisk,
      total: value(items),
      atRiskTotal: value(atRisk),
      unpriced: items.filter((r) => !r.purchase_price).length,
      excludedPersonal: rows.filter((r) => !r.owned_by_madtown),
      excludedLost: rows.filter((r) => r.owned_by_madtown && r.status === "Lost"),
      depreciation: "Phase 3 (roadmap): depreciation method to be agreed with Naveen",
    };
  });
}

/** FR-CON-009 (Phase 3 Could): total cost of ownership = purchase price + repairs */
export async function tco(u: CurrentUser) {
  if (!u.financeVisible) throw new AppError("NOT_ALLOWED", "Costs are restricted", 403);
  return withUser(
    u.id,
    async (c) =>
      (
        await c.query(`
    select i.id, i.name, f.purchase_price, coalesce((select sum(mc.cost) from maintenance_events m join maintenance_costs mc on mc.event_id = m.id where m.item_id = i.id), 0) repairs,
           coalesce(f.purchase_price, 0) + coalesce((select sum(mc.cost) from maintenance_events m join maintenance_costs mc on mc.event_id = m.id where m.item_id = i.id), 0) total
      from items i left join item_financials f on f.item_id = i.id
     where f.purchase_price is not null or exists (select 1 from maintenance_events m join maintenance_costs mc on mc.event_id = m.id where m.item_id = i.id)
     order by total desc`)
      ).rows,
  );
}

/** FR-RPT-007: printable list of items and kit contents reserved for a shoot */
export async function pickList(u: CurrentUser, shoot: string) {
  return withUser(
    u.id,
    async (c) =>
      (
        await c.query(
          `
    select r.shoot, r.starts_at, r.ends_at, p.name as person, coalesce(r.item_id, ki.item_id) as item_id, i.name, i.display_status as status, r.kit_id, k.name as kit_name,
           ki.required, ki.quantity
      from reservations r join people p on p.id = r.person_id
      left join kits k on k.id = r.kit_id left join kit_items ki on ki.kit_id = r.kit_id
      join items_v i on i.id = coalesce(r.item_id, ki.item_id)
     where r.status in ('Active','Fulfilled') and r.shoot = $1
     order by r.kit_id nulls first, coalesce(r.item_id, ki.item_id)`,
          [shoot],
        )
      ).rows,
  );
}

export async function shoots(u: CurrentUser) {
  return withUser(
    u.id,
    async (c) => (await c.query(`select shoot, min(starts_at) starts_at from reservations where status <> 'Cancelled' group by shoot order by 2 desc limit 100`)).rows,
  );
}
