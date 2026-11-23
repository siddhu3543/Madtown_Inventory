import { withService, type Db } from "../db";
import { buildPlan, summarize, type Plan, type Rules, type Warn } from "./plan";

export type ImportMode = "dry-run" | "apply" | "final";
export type ImportResult = { runId: string; mode: ImportMode; status: "succeeded" | "failed"; summary: Record<string, unknown>; warnings: Warn[]; error?: string };

async function loadRules(c: Db, fileRules: Rules): Promise<Rules> {
  const db = (await c.query("select target, rule from import_mapping_rules where active order by created_at")).rows;
  const out: Rules = { ...fileRules };
  for (const r of db) out[r.target] = { ...(out[r.target] ?? {}), ...r.rule }; // DB decisions override file proposals
  delete out._comment;
  return out;
}

/**
 * Runs the sheet import (section 11.1). dry-run: everything executes inside a transaction that is rolled back,
 * so the report reflects exactly what would happen. apply: staging, repeatable on an empty catalog.
 * final: production, once (MIG-015, unique index). All rows written with source Import (NFR-016).
 */
export async function runImport(opts: {
  sheet1: string;
  toBuy: string;
  unsorted: string;
  fileRules: Rules;
  mode: ImportMode;
  /** delete what earlier imports created (items, legacy loans, to-buy and unsorted rows) before importing again */
  replace?: boolean;
  startedBy: string | null;
  environment: string;
  source: string;
}): Promise<ImportResult> {
  let plan: Plan | null = null;
  let error: string | undefined;
  let rules: Rules = {};
  const runId = await withService(
    async (c) =>
      (
        await c.query("insert into import_runs(mode, environment, source_description, started_by) values ($1,$2,$3,$4) returning id", [
          opts.mode,
          opts.environment,
          opts.source,
          opts.startedBy,
        ])
      ).rows[0].id as string,
  );
  try {
    await withService(async (c) => {
      rules = await loadRules(c, opts.fileRules);
      const known = (await c.query("select name from people")).rows.map((r) => r.name);
      const types = (await c.query("select name from item_types where status <> 'Rejected' order by sort")).rows.map((r) => r.name);
      plan = buildPlan(opts.sheet1, opts.toBuy, opts.unsorted, rules, known, types);
      const structural = plan.warnings.filter((w) => w.level === "error" && ["HEADER_MISSING", "EMPTY"].includes(w.code));
      if (structural.length) throw new Error(`Sheet structure errors: ${structural.map((w) => w.message).join("; ")}`);
      await c.query("select set_config('app.source', 'Import', true)");
      const existing = (await c.query("select count(*)::int n from items where imported")).rows[0].n;
      if (existing > 0 && opts.replace) await purgePreviousImport(c);
      else if (existing > 0) {
        throw new Error(
          `The catalog already holds ${existing} items from an earlier import. Tick "Replace data from earlier imports" to swap them for this sheet${opts.mode === "dry-run" ? " (the preview then shows exactly what the replace does)" : ""}.`,
        );
      }
      const clash = (await c.query("select id from items where id = any($1::text[]) order by id", [plan.items.map((i) => i.id)])).rows.map((r) => r.id);
      if (clash.length)
        throw new Error(
          `These item IDs already exist in the app (added by hand, not by an import): ${clash.slice(0, 10).join(", ")}${clash.length > 10 ? ` and ${clash.length - 10} more` : ""}. Remove them or change the IDs in the sheet.`,
        );
      await apply(c, plan, runId);
      await c.query("set constraints all immediate"); // dry-run must hit the same deferred checks as a real commit
      if (opts.mode === "dry-run") throw new Error(DRY_RUN_DONE); // roll the transaction back
    }, "Import");
  } catch (e) {
    const ex = e as Error & { code?: string };
    if (ex.code !== "DRY_RUN_DONE" && ex.message !== DRY_RUN_DONE) error = explain(ex);
  }
  const p = plan as Plan | null;
  const summary = p ? { ...summarize(p), rules_applied: Object.keys(rules).length } : {};
  await withService(async (c) => {
    await c.query("update import_runs set finished_at = now(), status = $2, summary = $3 where id = $1", [runId, error ? "failed" : "succeeded", { ...summary, error }]);
    if (p) {
      const ws = p.warnings;
      for (let i = 0; i < ws.length; i += 500) {
        const chunk = ws.slice(i, i + 500);
        const vals = chunk.map((_, j) => `($1, $${j * 6 + 2}, $${j * 6 + 3}, $${j * 6 + 4}, $${j * 6 + 5}, $${j * 6 + 6}, $${j * 6 + 7})`).join(",");
        await c.query(`insert into import_row_results(run_id, tab, sheet_row, record_ref, level, code, message) values ${vals}`, [
          runId,
          ...chunk.flatMap((w) => [w.tab, w.row, w.ref, w.level, w.code, w.message]),
        ]);
      }
    }
    if (!error && opts.mode !== "dry-run")
      await c.query("select app.log_event('import', 'import_runs', $1, null, null, $2::jsonb, $3)", [runId, JSON.stringify(summary), `${opts.mode} import of ${opts.source}`]);
  }, "Import");
  return { runId, mode: opts.mode, status: error ? "failed" : "succeeded", summary, warnings: p?.warnings ?? [], error };
}
const DRY_RUN_DONE = "DRY_RUN_DONE: preview finished, rolled back";

/** Database errors in words the Owner can act on (errors arrive wrapped by toAppError) */
function explain(e: Error & { code?: string }): string {
  const msg = e.message ?? String(e);
  if ((e.code === "REFERENCE" || e.code === "23503") && /violates foreign key constraint .* on table "(\w+)"/.test(msg) && /^update or delete/.test(msg))
    return `Earlier imported data is already used by records made in the app (table ${msg.match(/on table "(\w+)"$/)?.[1] ?? "?"}). Replace is blocked so that history is not lost; remove or close those records first. (${msg})`;
  if (e.code === "DUPLICATE" || e.code === "23505") return `Duplicate value: ${msg}`;
  if (e.code === "CONSTRAINT" || e.code === "23514") return `A row breaks a data rule: ${msg}`;
  return msg || "Import failed (no message)";
}

/**
 * What would be lost if the earlier import were replaced: anything made or changed in the app (or by the Sheets
 * sync) on imported items, legacy loans, to-buy and unsorted rows. Two independent checks — the audit log (every
 * change carries its item and source) and the tables themselves (in case a row was written outside the audit) —
 * so Replace never cascades away a loan, repair, photo, incident or edit someone made in the app.
 */
export async function findAppActivity(c: Db): Promise<string[]> {
  const found: string[] = [];
  const audit = (
    await c.query(
      `select coalesce(a.item_id, a.table_name) ref
         from audit_log a
        where a.source in ('App','Sync') and (
              a.item_id in (select id from _imp)
           or (a.table_name = 'wishlist_items' and a.record_id in (select id::text from wishlist_items where legacy))
           or (a.table_name = 'unsorted_items' and a.record_id in (select id::text from unsorted_items where sheet_row is not null))
           or (a.table_name in ('loans','loan_extensions') and a.record_id in (select id::text from loans where created_via = 'Import')))
        group by 1 order by max(a.at) desc`,
    )
  ).rows.map((r) =>
    (r.ref as string)
      .replace(/^wishlist_items$/, "to-buy rows")
      .replace(/^unsorted_items$/, "unsorted rows")
      .replace(/^loans$/, "imported loans"),
  );
  const list = (refs: string[]) => `${refs.slice(0, 6).join(", ")}${refs.length > 6 ? ` and ${refs.length - 6} more` : ""}`;
  if (audit.length) found.push(`changed in the app: ${list(audit)}`);
  const checks: [string, string][] = [
    [
      "loans made in the app",
      "select distinct l.item_id ref from loan_lines l join loans o on o.id = l.loan_id where o.created_via <> 'Import' and l.item_id in (select id from _imp)",
    ],
    [
      "check-ins or transfers on imported loans",
      "select distinct e.item_id ref from loan_events e join loans o on o.id = e.loan_id where o.created_via = 'Import' and e.event <> 'legacy'",
    ],
    ["photos taken in the app", "select distinct item_id ref from photos where item_id in (select id from _imp) and provider <> 'legacy-link'"],
    ["repairs or services", "select distinct item_id ref from maintenance_events where not legacy and item_id in (select id from _imp)"],
    ["maintenance schedules", "select distinct item_id ref from maintenance_schedules where item_id in (select id from _imp)"],
    ["incidents", "select distinct item_id ref from incidents where not legacy and item_id in (select id from _imp)"],
    ["missing parts", "select distinct item_id ref from missing_parts where not legacy and item_id in (select id from _imp)"],
    ["detached accessories", "select distinct item_id ref from detached_accessories where not legacy and item_id in (select id from _imp)"],
    ["retirement requests", "select distinct item_id ref from retirement_requests where item_id in (select id from _imp)"],
    ["walkthrough audits", "select distinct item_id ref from audit_lines where item_id in (select id from _imp)"],
    ["kits", "select distinct item_id ref from kit_items where item_id in (select id from _imp)"],
    ["reservations", "select distinct item_id ref from reservations where item_id in (select id from _imp)"],
    [
      "orders received into imported items",
      "select distinct li.item_id ref from order_line_items li join order_lines ol on ol.id = li.order_line_id join orders o on o.id = ol.order_id where li.item_id in (select id from _imp) and o.notes is distinct from 'Imported from sheet notes'",
    ],
    ["orders placed from imported to-buy rows", "select distinct w.item_description ref from order_lines ol join wishlist_items w on w.id = ol.wishlist_id where w.legacy"],
    [
      "items added in the app linked to imported items",
      "select id ref from items where not imported and (parent_item_id in (select id from _imp) or case_item_id in (select id from _imp))",
    ],
    [
      "unsorted rows added in the app pointing at imported items",
      "select item ref from unsorted_items where sheet_row is null and (duplicate_of_item_id in (select id from _imp) or converted_item_ids && array(select id from _imp))",
    ],
  ];
  for (const [label, sql] of checks) {
    const refs = (await c.query(sql)).rows.map((r) => r.ref as string);
    if (refs.length) found.push(`${label}: ${list(refs)}`);
  }
  return found;
}

/**
 * Removes everything earlier imports created, in dependency order, inside the import transaction (so a preview
 * shows the result and a failure rolls it all back). Refuses — before deleting anything — when findAppActivity
 * reports work done in the app, because several tables cascade-delete with their item.
 */
export async function purgePreviousImport(c: Db) {
  const q = (sql: string) => c.query(sql);
  await q("create temp table _imp on commit drop as select id from items where imported");
  const activity = await findAppActivity(c);
  if (activity.length)
    throw new Error(
      `REPLACE_BLOCKED: Replace stopped — nothing was deleted. The earlier import has been used in the app, and replacing it would delete that history (${activity.join("; ")}). Keep the current data and update it in the app, or import into an empty catalog.`,
    );
  await q("update unsorted_items set duplicate_of_item_id = null where duplicate_of_item_id in (select id from _imp)");
  await q("delete from unsorted_items where sheet_row is not null");
  await q("delete from missing_parts where legacy and item_id in (select id from _imp)");
  await q("update wishlist_items set source_missing_part_id = null where source_missing_part_id is not null and source_missing_part_id not in (select id from missing_parts)");
  await q("delete from wishlist_items where legacy");
  await q("create temp table _ord on commit drop as select id from orders where notes = 'Imported from sheet notes'");
  await q("delete from order_line_items where order_line_id in (select id from order_lines where order_id in (select id from _ord))");
  await q("delete from orders where id in (select id from _ord)");
  await q("create temp table _loan on commit drop as select id from loans where created_via = 'Import'");
  await q("update item_holdings set loan_line_id = null where loan_line_id in (select id from loan_lines where loan_id in (select id from _loan))");
  await q("delete from loans where id in (select id from _loan)");
  await q("delete from item_holdings where item_id in (select id from _imp)");
  await q("delete from detached_accessories where legacy and item_id in (select id from _imp)");
  await q("delete from maintenance_events where legacy and item_id in (select id from _imp)");
  await q("delete from incidents where legacy and item_id in (select id from _imp)");
  await q("update items set parent_item_id = null, case_item_id = null where id in (select id from _imp)");
  await q("update items set stock_image_photo_id = null, latest_photo_id = null where id in (select id from _imp)");
  await q("delete from photos where item_id in (select id from _imp)");
  await q("delete from items where id in (select id from _imp)");
}

async function apply(c: Db, p: Plan, runId: string) {
  const one = async (sql: string, params: unknown[]) => (await c.query(sql, params)).rows[0];
  const madtown = (await one("select id from people where is_madtown", [])).id as string;
  const office = (await one("select id from locations where is_default_home", [])).id as string;
  for (const t of p.newTypes) await c.query("insert into item_types(name, status, sort, default_loan_days) values ($1, 'Approved', 200, 7) on conflict (name) do nothing", [t]);
  for (const n of p.people) {
    await c.query(
      `insert into people(name, person_type, person_type_to_verify, notes) values ($1, 'Freelancer', true, 'Created by sheet import; type to verify') on conflict (lower(name)) do nothing`,
      [n],
    );
  }
  const pid = new Map<string, string>((await c.query("select id, name from people")).rows.map((r) => [r.name.toLowerCase(), r.id]));
  const personId = (n: string | null) => (n ? (pid.get(n.toLowerCase()) ?? null) : null);

  // items
  for (const it of p.items) {
    const toVerify = it.to_verify_reasons.length > 0 || it.model_tbd;
    const singleHolder = it.quantity_mode === "Single" && it.status !== "Lost" && it.status !== "Missing";
    const hp = singleHolder && it.holder && it.holder !== "Office" ? personId(it.holder) : null;
    await c.query(
      `insert into items(id, name, model_number, model_tbd, brand, type, subtype, quantity_mode, stock, stock_to_verify, stock_to_verify_reason, status, condition,
                         owner_person_id, holder_person_id, holder_location_id, home_location_id, needs_case, notes, to_verify, to_verify_reason, sheet_row, imported)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,true)`,
      [
        it.id,
        it.name,
        it.model_number,
        it.model_tbd,
        it.brand,
        it.type,
        it.subtype,
        it.quantity_mode,
        it.stock,
        it.stock_to_verify,
        it.stock_to_verify_reason,
        it.status,
        it.condition,
        it.owner === "Madtown" ? madtown : personId(it.owner),
        hp,
        singleHolder && !hp ? office : null,
        office,
        it.needs_case,
        it.notes,
        toVerify,
        it.to_verify_reasons.join("; ") || null,
        it.sheet_row,
      ],
    );
    await c.query("insert into item_import_raw(item_id, sheet_row, legacy_raw, import_run_id) values ($1,$2,$3,$4)", [it.id, it.sheet_row, it.raw, runId]);
  }
  for (const it of p.items) if (it.parent) await c.query("update items set parent_item_id = $2 where id = $1", [it.id, it.parent]);

  // photos (FR-PHO-001, 006, 007)
  for (const it of p.items)
    for (const ph of it.photos) {
      const r = await one(
        `insert into photos(item_id, kind, provider, provider_file_id, provider_folder_id, original_url, link_kind, legacy_text, upload_state, note)
                         values ($1,$2,'legacy-link',$3,$4,$5,$6,$7,'legacy',$8) returning id`,
        [it.id, ph.kind, ph.provider_file_id, ph.provider_folder_id, ph.original_url, ph.link_kind, ph.legacy_text, ph.note ?? "Imported from sheet"],
      );
      if (ph.link_kind !== "text" && ph.primary)
        await c.query(`update items set ${ph.kind === "Stock" ? "stock_image_photo_id" : "latest_photo_id"} = $2 where id = $1`, [it.id, r.id]);
    }

  // legacy loans first (lines must exist before Checked-out holdings reference them)
  const lineFor = new Map<string, string>(); // `${item}|${borrower}` -> line id
  for (const l of p.loans) {
    const b = personId(l.borrower);
    if (!b) throw new Error(`Unknown borrower ${l.borrower}`);
    const loan = await one(
      `insert into loans(borrower_person_id, status, legacy, to_verify, checked_in_at, condition_in, close_reason, notes, created_via)
                            values ($1,$2,true,$3,$4,$5,$6,$7,'Import') returning id`,
      [b, l.status, l.to_verify, l.checked_in_at, l.condition_in ?? null, l.status === "Returned" ? "Returned" : null, l.note],
    );
    const line = await one(`insert into loan_lines(loan_id, item_id, quantity, qty_returned) values ($1,$2,$3,$4) returning id`, [
      loan.id,
      l.item_id,
      l.quantity,
      l.status === "Returned" ? l.quantity : 0,
    ]);
    await c.query(`insert into loan_events(loan_id, line_id, item_id, event, quantity, at, person_id, note) values ($1,$2,$3,'legacy',$4,coalesce($5, now()),$6,$7)`, [
      loan.id,
      line.id,
      l.item_id,
      l.quantity,
      l.checked_in_at,
      b,
      l.note,
    ]);
    if (l.status === "Open") lineFor.set(`${l.item_id}|${l.borrower.toLowerCase()}`, line.id);
  }
  // counted holdings
  for (const it of p.items)
    if (it.quantity_mode === "Counted")
      for (const h of it.holdings) {
        if (h.qty <= 0) continue;
        const isOffice = h.holder === "Office";
        await c.query(`insert into item_holdings(item_id, holder_person_id, holder_location_id, status, quantity, loan_line_id, to_verify) values ($1,$2,$3,$4,$5,$6,$7)`, [
          it.id,
          h.holder && !isOffice ? personId(h.holder) : null,
          isOffice || (h.holder === null && !["Lost", "Missing"].includes(h.status)) ? office : null,
          h.status,
          h.qty,
          h.status === "Checked out" ? (lineFor.get(`${it.id}|${(h.holder ?? "").toLowerCase()}`) ?? null) : null,
          !!h.to_verify,
        ]);
      }
  // detached accessories
  for (const it of p.items)
    for (const d of it.detached)
      await c.query("insert into detached_accessories(item_id, description, holder_person_id, reason, legacy) values ($1,$2,$3,$4,true)", [
        it.id,
        d.description,
        personId(d.holder),
        d.reason,
      ]);

  // maintenance (MIG-005, FR-CON-008)
  for (const m of p.maintenance) {
    const ev = await one(
      `insert into maintenance_events(item_id, type, state, issue_description, cause, event_date_text, year_to_verify, legacy, to_verify, closed_at)
                          values ($1,$2,$3,$4,$5,$6,$7,true,$8, case when $3 = 'Closed' then now() end) returning id`,
      [m.item_id, m.type, m.state, m.issue, m.cause, m.event_date_text, m.year_to_verify, m.to_verify],
    );
    await c.query("insert into maintenance_state_history(event_id, from_state, to_state, note) values ($1, null, $2, 'Imported from sheet')", [ev.id, m.state]);
  }
  // incidents (MIG-007)
  for (const i of p.incidents)
    await c.query(
      `insert into incidents(item_id, type, quantity, description, history_known, last_seen_place, last_seen_at_text, responsible_person_id, last_known_holder_person_id, legacy, to_verify)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true)`,
      [i.item_id, i.type, i.quantity, i.description, i.history_known, i.last_seen_place, i.last_seen_at_text, personId(i.responsible), personId(i.last_known_holder)],
    );
  // financials and orders (FR-CAT-012, FR-BUY-006)
  for (const f of p.financials)
    await c.query("insert into item_financials(item_id, purchase_date, vendor, order_ref, purchase_price, price_note) values ($1,$2,$3,$4,$5,$6)", [
      f.item_id,
      f.purchase_date,
      f.vendor,
      f.order_ref,
      f.purchase_price,
      f.price_note,
    ]);
  for (const o of p.orders) {
    const r = await one(
      `insert into orders(vendor, order_ref, order_date, status, delivered_at, cancelled_reason, notes) values ($1,$2,coalesce($3::date, current_date),$4,$5,$6,'Imported from sheet notes') returning id`,
      [o.vendor, o.order_ref, o.order_date, o.status, o.status === "Delivered" ? o.order_date : null, o.status === "Cancelled" ? "Cancelled (per sheet notes)" : null],
    );
    if (o.amount !== null) await c.query("insert into order_financials(order_id, amount) values ($1,$2)", [r.id, o.amount]);
    const line = await one("insert into order_lines(order_id, description, quantity, received_qty) values ($1,$2,1,$3) returning id", [
      r.id,
      `Item ${o.item_id}`,
      o.status === "Delivered" ? 1 : 0,
    ]);
    if (o.status === "Delivered") await c.query("insert into order_line_items(order_line_id, item_id) values ($1,$2)", [line.id, o.item_id]);
  }
  // to-buy (MIG-011)
  const wlByRow = new Map<number, string>();
  for (const wl of p.wishlist) {
    const r = await one(
      `insert into wishlist_items(item_description, reason, replaces_or_adds, replaces_or_adds_note, priority, status, verify_first, notes, sheet_row, legacy, proposed_at,
                                  decision_comment, rejected_at, approved_at)
                         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true, now(), $10,
                                 case when $6 = 'Rejected' then now() end, case when $6 in ('Approved','Ordered','Received') then now() end) returning id`,
      [wl.item_description, wl.reason, wl.replaces_or_adds, wl.replaces_or_adds_note, wl.priority, wl.status, wl.verify_first, wl.notes, wl.sheet_row, wl.sheet_status],
    );
    wlByRow.set(wl.sheet_row, r.id);
    await c.query("insert into wishlist_financials(wishlist_id, legacy_raw) values ($1,$2)", [r.id, wl.raw]);
    for (const rel of wl.related) await c.query("insert into wishlist_related_items(wishlist_id, item_id) values ($1,$2) on conflict do nothing", [r.id, rel]);
  }
  // missing parts (MIG-006) linked to to-buy where the line matches (AC-KIT-03)
  for (const mp of p.missingParts as (Plan["missingParts"][number] & { wishlist_row?: number })[])
    await c.query("insert into missing_parts(item_id, description, legacy, to_verify, wishlist_id) values ($1,$2,true,true,$3)", [
      mp.item_id,
      mp.description,
      mp.wishlist_row ? (wlByRow.get(mp.wishlist_row) ?? null) : null,
    ]);
  // unsorted (MIG-012/013)
  for (const u of p.unsorted)
    await c.query(
      "insert into unsorted_items(sheet_row, item, known, question, who_can_answer, status, duplicate_of_item_id, converted_item_ids, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [u.sheet_row, u.item, u.known, u.question, u.who, u.status, u.duplicate_of, u.converted_item_ids, u.notes],
    );
  // counted status consistency
  for (const it of p.items) if (it.quantity_mode === "Counted") await c.query("select app.refresh_counted_status($1)", [it.id]);
}
