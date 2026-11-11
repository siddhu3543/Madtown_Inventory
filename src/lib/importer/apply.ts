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
      plan = buildPlan(opts.sheet1, opts.toBuy, opts.unsorted, rules, known);
      if (plan.warnings.some((w) => w.level === "error" && ["HEADER_MISSING", "EMPTY"].includes(w.code))) throw new Error("Sheet structure errors; fix the export first");
      const existing = (await c.query("select count(*)::int n from items where imported")).rows[0].n;
      if (existing > 0 && opts.mode !== "dry-run")
        throw new Error(
          `Catalog already holds ${existing} imported items; ${opts.mode === "final" ? "the production import runs once (MIG-015)" : "reset staging before re-importing"}`,
        );
      if (opts.mode !== "dry-run") await c.query("select set_config('app.source', 'Import', true)");
      await apply(c, plan, runId);
      await c.query("set constraints all immediate"); // dry-run must hit the same deferred checks as a real commit
      if (opts.mode === "dry-run") throw new DryRunDone();
    }, "Import");
  } catch (e) {
    if (!(e instanceof DryRunDone)) error = (e as Error).message;
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
class DryRunDone extends Error {}

async function apply(c: Db, p: Plan, runId: string) {
  const one = async (sql: string, params: unknown[]) => (await c.query(sql, params)).rows[0];
  const madtown = (await one("select id from people where is_madtown", [])).id as string;
  const office = (await one("select id from locations where is_default_home", [])).id as string;
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
                         values ($1,$2,'legacy-link',$3,$4,$5,$6,$7,'legacy','Imported from sheet') returning id`,
        [it.id, ph.kind, ph.provider_file_id, ph.provider_folder_id, ph.original_url, ph.link_kind, ph.legacy_text],
      );
      if (ph.link_kind !== "text") await c.query(`update items set ${ph.kind === "Stock" ? "stock_image_photo_id" : "latest_photo_id"} = $2 where id = $1`, [it.id, r.id]);
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
      `insert into wishlist_items(item_description, reason, replaces_or_adds, replaces_or_adds_note, priority, status, verify_first, notes, sheet_row, legacy, proposed_at)
                         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true, now()) returning id`,
      [wl.item_description, wl.reason, wl.replaces_or_adds, wl.replaces_or_adds_note, wl.priority, wl.status, wl.verify_first, wl.notes, wl.sheet_row],
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
    await c.query("insert into unsorted_items(sheet_row, item, known, question, who_can_answer, status, duplicate_of_item_id) values ($1,$2,$3,$4,$5,$6,$7)", [
      u.sheet_row,
      u.item,
      u.known,
      u.question,
      u.who,
      u.status,
      u.duplicate_of,
    ]);
  // counted status consistency
  for (const it of p.items) if (it.quantity_mode === "Counted") await c.query("select app.refresh_counted_status($1)", [it.id]);
}
