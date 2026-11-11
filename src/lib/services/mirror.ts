import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Papa from "papaparse";
import { withService } from "../db";
import { env } from "../env";
import { fmtDate } from "../format";

export const SHEET1_COLUMNS = [
  "Item ID",
  "Item name",
  "Model Number",
  "Type",
  "Stock",
  "Links",
  "Updated links",
  "Notes",
  "Condition",
  "Posession",
  "Checked Out For",
  "Checked Out Date",
  "Checked In Date",
];

const photoLink = (p: { provider: string; provider_file_id: string | null; original_url: string | null; link_kind: string; legacy_text: string | null; id: string } | null) => {
  if (!p) return "";
  if (p.link_kind === "text") return p.legacy_text ?? "";
  if (p.original_url) return p.original_url;
  if (p.provider === "drive" && p.provider_file_id) return `https://drive.google.com/file/d/${p.provider_file_id}/view`;
  return `${env.appBaseUrl}/api/photos/${p.id}/file?size=full`;
};

/** FR-RPT-009 / AC-RPT-02 / D-23: rows in the sheet's current 13-column layout with current values. */
export async function buildMirror() {
  return withService(async (c) => {
    const mask = ((await c.query("select app.setting('mask_prices_in_notes') v")).rows[0]?.v ?? true) !== false;
    const items = (
      await c.query(`
      select i.*, coalesce(hp.name, case when hl.is_default_home then 'Madtown' else hl.name end) as holder_name,
        (select to_jsonb(ph) from photos ph where ph.id = i.stock_image_photo_id) as stock_photo,
        (select to_jsonb(ph) from photos ph where ph.id = coalesce(i.latest_photo_id, (select x.id from photos x where x.item_id = i.id and x.kind = 'Latest' and x.link_kind = 'text' limit 1))) as latest_photo,
        (select string_agg(x.n, ', ' order by x.ord, x.n) from (
            select case when h.status = 'Lost' then 'Lost' when h.status = 'Missing' then 'Missing' else coalesce(p.name, case when l.is_default_home then 'Madtown' else l.name end) end as n,
                   case when l.is_default_home then 0 else 1 end ord
              from item_holdings h left join people p on p.id = h.holder_person_id left join locations l on l.id = h.holder_location_id
              cross join lateral generate_series(1, least(h.quantity, 1)) g where h.item_id = i.id and h.quantity > 0) x) as holdings_names,
        (select string_agg(distinct p.name, ', ') from loan_lines ll join loans lo on lo.id = ll.loan_id join people p on p.id = lo.borrower_person_id
          where ll.item_id = i.id and ll.active) as out_for,
        (select max(lo.checked_out_at) from loan_lines ll join loans lo on lo.id = ll.loan_id where ll.item_id = i.id and ll.active) as out_at,
        (select max(lo.checked_in_at) from loan_lines ll join loans lo on lo.id = ll.loan_id where ll.item_id = i.id and lo.close_reason is distinct from 'Transferred') as in_at
      from items i left join people hp on hp.id = i.holder_person_id left join locations hl on hl.id = i.holder_location_id
      order by (regexp_match(i.id, '^MTMH_([0-9]+)'))[1]::int, i.id`)
    ).rows;
    const maskTxt = (t: string | null) => (t && mask ? t.replace(/(Rs\.?|INR|₹)\s?[0-9][0-9,]*(\.[0-9]+)?(\s*\/-)?/gi, "$1 ▒▒▒") : (t ?? ""));
    const sheet1 = items.map((i) => [
      i.id,
      i.name,
      i.model_tbd ? "TBD" : (i.model_number ?? ""),
      i.type,
      i.stock === 0 && i.stock_to_verify ? "" : String(i.stock),
      photoLink(i.stock_photo),
      photoLink(i.latest_photo),
      maskTxt(i.notes),
      i.status === "Lost" ? "Lost" : i.status === "In repair" ? "Repairing" : (i.condition ?? ""),
      i.status === "Lost" ? "Lost" : i.quantity_mode === "Counted" ? (i.holdings_names ?? "") : (i.holder_name ?? ""),
      i.out_for ?? "",
      i.out_at ? fmtDate(i.out_at) : "",
      i.in_at ? fmtDate(i.in_at) : "",
    ]);
    const tobuy = (
      await c.query(`select w.*, (select string_agg(r.item_id, ', ' order by r.item_id) from wishlist_related_items r where r.wishlist_id = w.id) rel
                                    from wishlist_items w order by w.sheet_row nulls last, w.created_at`)
    ).rows.map((w) => [
      w.item_description,
      w.reason,
      w.rel ?? "",
      w.replaces_or_adds + (w.replaces_or_adds_note ? ` ${w.replaces_or_adds_note}` : ""),
      w.priority,
      w.status,
      maskTxt(w.notes),
    ]);
    const unsorted = (await c.query("select * from unsorted_items order by sheet_row nulls last, created_at")).rows.map((u) => [
      u.item,
      u.known ?? "",
      u.question ?? "",
      u.who_can_answer ?? "",
      u.status,
    ]);
    return {
      Sheet1: [SHEET1_COLUMNS, ...sheet1],
      "To buy": [["Item", "Reason", "Related item ID", "Replaces or adds", "Priority", "Status", "Notes"], ...tobuy],
      "Not yet sorted": [["Item", "What we know", "Question", "Who can answer", "Status"], ...unsorted],
    } as Record<string, string[][]>;
  });
}

async function writeSheets(tabs: Record<string, string[][]>) {
  const { GoogleAuth } = await import("google-auth-library");
  const id = process.env.MIRROR_SPREADSHEET_ID,
    raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!id || !raw) throw new Error("Sheets mirror not configured: MIRROR_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON_B64 required");
  const auth = new GoogleAuth({ credentials: JSON.parse(Buffer.from(raw, "base64").toString()), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  const api = async (path: string, body: unknown, method = "POST") => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  };
  for (const [tab, rows] of Object.entries(tabs)) {
    await api(`/values/${encodeURIComponent(`'${tab}'`)}:clear`, {});
    await api(`/values/${encodeURIComponent(`'${tab}'!A1`)}?valueInputOption=RAW`, { range: `'${tab}'!A1`, majorDimension: "ROWS", values: rows }, "PUT");
  }
  // OQ-S-06: protection (only the service account edits) is set once during setup; see docs/DEPLOYMENT.md
}

/** One-way, app -> sheet (A4). Never reads back from the sheet. */
export async function runMirror(trigger: "nightly" | "manual", startedBy: string | null) {
  const target = env.mirrorProvider === "sheets" ? `sheets:${process.env.MIRROR_SPREADSHEET_ID}` : `csv:${process.env.MIRROR_CSV_DIR ?? ".mirror"}`;
  const runId = await withService(
    async (c) => (await c.query("insert into mirror_runs(trigger, target, started_by) values ($1,$2,$3) returning id", [trigger, target, startedBy])).rows[0].id,
  );
  try {
    const tabs = await buildMirror();
    if (env.mirrorProvider === "sheets") await writeSheets(tabs);
    else {
      const dir = resolve(process.env.MIRROR_CSV_DIR ?? ".mirror");
      await mkdir(dir, { recursive: true });
      for (const [tab, rows] of Object.entries(tabs)) await writeFile(join(dir, `${tab}.csv`), Papa.unparse(rows));
    }
    const n = tabs["Sheet1"].length - 1;
    await withService(async (c) => {
      await c.query("update mirror_runs set finished_at = now(), status = 'succeeded', rows_written = $2 where id = $1", [runId, n]);
      await c.query("select app.log_event('sync', 'mirror_runs', $1, null, null, $2::jsonb, $3)", [runId, JSON.stringify({ rows: n, target }), `${trigger} Sheets mirror`]);
    }, "Sync"); // NFR-016: mirror writes tagged Sync
    return { runId, rows: n, target };
  } catch (e) {
    await withService((c) => c.query("update mirror_runs set finished_at = now(), status = 'failed', error = $2 where id = $1", [runId, (e as Error).message]));
    throw e;
  }
}
