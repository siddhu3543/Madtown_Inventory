import Papa from "papaparse";
import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { listItems } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { loansReport, repairsReport, utilisation, assetValue } from "@/lib/services/reports";

type Ctx = { params: Promise<{ report: string }> };
const csv = (name: string, rows: Record<string, unknown>[]) =>
  new NextResponse(Papa.unparse(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });

/** FR-RPT-002 / AC-RPT-03 inventory CSV; FR-AUD-002 audit CSV (Owner); other report CSVs. No cost columns for non-finance roles. */
export const GET = api<Ctx>(async (u, req, { params }) => {
  const { report } = await params;
  if (u.role !== "Admin") throw new AppError("NOT_ALLOWED", "Reports and exports are for Admins only", 403);
  const sp = new URL(req.url).searchParams;
  if (report === "inventory.csv") {
    const rows = await listItems(u, {
      q: sp.get("q") ?? undefined,
      type: sp.get("type") ?? undefined,
      status: sp.get("status") ?? undefined,
      condition: sp.get("condition") ?? undefined,
      holder: sp.get("holder") ?? undefined,
      owner: sp.get("owner") ?? undefined,
      view: sp.get("view") ?? undefined,
      includeRetired: sp.get("retired") === "1",
    });
    const fin = u.financeVisible
      ? await withUser(u.id, async (c) => new Map((await c.query("select item_id, purchase_price, purchase_date, vendor from item_financials")).rows.map((r) => [r.item_id, r])))
      : null;
    return csv(
      "inventory.csv",
      rows.map((r) => ({
        "Item ID": r.id,
        "Item name": r.name,
        "Model number": r.model_number ?? "",
        Type: r.type,
        Subtype: r.subtype ?? "",
        Mode: r.quantity_mode,
        Stock: r.stock,
        Available: r.available_qty,
        Status: r.display_status,
        Condition: r.condition ?? "",
        Owner: r.owner_name,
        Holder: r.quantity_mode === "Counted" ? (r.holder_names ?? "") : (r.holder_label ?? ""),
        "To verify": r.to_verify || r.stock_to_verify || r.model_tbd ? (r.to_verify_reason ?? r.stock_to_verify_reason ?? "yes") : "",
        Notes: r.notes ?? "",
        ...(fin
          ? {
              "Purchase price (Rs)": fin.get(r.id)?.purchase_price ?? "",
              "Purchase date": fin.get(r.id)?.purchase_date ? fmtDate(fin.get(r.id).purchase_date) : "",
              Vendor: fin.get(r.id)?.vendor ?? "",
            }
          : {}),
      })),
    );
  }
  if (report === "audit-log.csv") {
    if (u.role !== "Admin") throw new AppError("NOT_ALLOWED", "The global audit log is for Admins only", 403);
    const rows = await withUser(
      u.id,
      async (c) =>
        (
          await c.query(
            `select * from audit_log where ($1::text is null or item_id = $1 or record_id = $1) and ($2::text is null or table_name = $2) and ($3::text is null or source = $3)
        and ($4::date is null or at >= $4::date) and ($5::date is null or at < $5::date + 1) order by id desc limit 50000`,
            [sp.get("record") || null, sp.get("table") || null, sp.get("source") || null, sp.get("from") || null, sp.get("to") || null],
          )
        ).rows,
    );
    return csv(
      "audit-log.csv",
      rows.map((a) => ({
        id: a.id,
        at: fmtDateTime(a.at),
        actor: a.actor_label,
        action: a.action,
        table: a.table_name,
        record: a.record_id,
        item: a.item_id,
        before: JSON.stringify(a.before_json),
        after: JSON.stringify(a.after_json),
        source: a.source,
        reason: a.reason ?? "",
      })),
    );
  }
  if (report === "loans.csv") {
    const r = await loansReport(u, sp.get("from") ?? "2000-01-01", sp.get("to") ?? "2100-01-01");
    return csv("loans-by-person.csv", r.byPerson);
  }
  if (report === "repairs.csv") return csv("repairs.csv", (await repairsReport(u)).byItem);
  if (report === "utilisation.csv") return csv("utilisation.csv", (await utilisation(u)).rows);
  if (report === "asset-value.csv")
    return csv(
      "asset-value.csv",
      (await assetValue(u)).items.map((i) => ({ id: i.id, name: i.name, type: i.type, status: i.status, purchase_price: i.purchase_price ?? "" })),
    );
  throw new AppError("NOT_FOUND", "Unknown report", 404);
});
