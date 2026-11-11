import "server-only";
import Papa from "papaparse";
import { withService } from "../db";
import { storage } from "../adapters/storage";
import { istParts } from "../format";

const TABLES = [
  "items",
  "item_financials",
  "item_holdings",
  "people",
  "locations",
  "loans",
  "loan_lines",
  "loan_events",
  "loan_extensions",
  "kits",
  "kit_items",
  "maintenance_events",
  "maintenance_costs",
  "incidents",
  "missing_parts",
  "wishlist_items",
  "wishlist_related_items",
  "orders",
  "order_financials",
  "order_lines",
  "order_line_items",
  "photos",
  "audits",
  "audit_lines",
  "reservations",
  "unsorted_items",
  "settings",
];

/** NFR-009: weekly export (CSV + JSON) to a Madtown Drive folder via the storage adapter. Daily DB backups are Supabase's (NFR-008). */
export async function weeklyExport(now: Date) {
  const key = `backup-${istParts(now).dateKey}`;
  const dump: Record<string, unknown[]> = {};
  await withService(async (c) => {
    for (const t of TABLES) dump[t] = (await c.query(`select * from public.${t}`)).rows;
  });
  const files: string[] = [];
  const s = storage();
  const json = Buffer.from(JSON.stringify({ exported_at: now.toISOString(), tables: dump }));
  files.push((await s.put("backups", `${key}.json`, json, "application/json")).fileId);
  for (const t of ["items", "loans", "loan_lines", "people", "maintenance_events", "incidents", "wishlist_items"]) {
    files.push((await s.put("backups", `${key}-${t}.csv`, Buffer.from(Papa.unparse(dump[t] as object[])), "text/csv")).fileId);
  }
  await withService(
    (c) => c.query("select app.log_event('weekly-export', 'backups', $1, null, null, $2::jsonb, 'NFR-009 weekly export')", [key, JSON.stringify({ files: files.length })]),
    "Job",
  );
  return { key, files: files.length, tables: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])) };
}
