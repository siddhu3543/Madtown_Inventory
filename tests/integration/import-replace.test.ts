/**
 * Re-importing: a second import is refused unless "Replace data from earlier imports" is ticked; with it, the earlier
 * import's items, legacy loans, to-buy and unsorted rows are swapped for the new sheet. Uses the real-sheet shape
 * (Stock written 1.0, a new type, free-text statuses) and an Excel workbook upload.
 */
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, svc, closePool, type Users } from "../helpers/db";
import { runImport } from "@/lib/importer/apply";
import { collectSheets } from "@/lib/importer/workbook";
import realRules from "@/lib/importer/mapping-rules.json";
import type { Rules } from "@/lib/importer/plan";

let U: Users;
const fixture = () => ({
  sheet1: readFileSync("fixtures/sheet/Sheet1.csv", "utf8"),
  toBuy: readFileSync("fixtures/sheet/To buy.csv", "utf8"),
  unsorted: readFileSync("fixtures/sheet/Not yet sorted.csv", "utf8"),
  fileRules: JSON.parse(readFileSync("fixtures/mapping-rules.json", "utf8")),
});
const S1 =
  "Item ID,Item name,Model Number,Type,Stock,Links,Updated links,Notes,Condition,Posession,Checked Out For,Checked Out Date,Checked In Date\n" +
  'MTMH_101,Sony FX3,ILME-FX3,Camera,1.0,https://drive.google.com/drive/folders/F1,"https://drive.google.com/file/d/NEW/view\nPrevious photo: https://drive.google.com/file/d/OLD/view",Serviced on 14th July,Good,Madtown,,,\n' +
  "MTMH_208,SanDisk Extreme PRO Portable SSD 2TB,SDSSDE81-2T00,Hard Disk,1.0,,,,,,,,\n" +
  "MTMH_191,Small Spring Clamps pack of 20,,Accessory,20.0,,,,Good,Madtown,,,\n" +
  'MTMH_212,Nikon camera (model unknown),,Camera,1.0,,,,,"Not at office, Anand checking at home",,,\n';
const TB = "Item,Reason,Related item ID,Replaces or adds,Priority,Status,Notes\nSony charger,Count,MTMH_101,Adds,Medium,Not needed (3 confirmed in photo),\n";
const NS = 'Item,What we know,Question,Who can answer,Status\nHard disks (several),Several,How many?,Anand,"Added to sheet, MTMH_208"\n';

async function xlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, text] of [
    ["Sheet1", S1],
    ["To buy", TB],
    ["Not yet sorted", NS],
  ]) {
    const ws = wb.addWorksheet(name);
    for (const r of Papa.parse<string[]>(text, { skipEmptyLines: true }).data) ws.addRow(r.map((v) => (/^\d+(\.0)?$/.test(v) ? +v : v)));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  U = await freshDb();
  const r = await runImport({ ...fixture(), mode: "apply", startedBy: U.owner.id, environment: "test", source: "fixture" });
  expect(r.error).toBeUndefined();
});
afterAll(closePool);

describe("re-import with Replace", () => {
  it("a second import without Replace is refused with an explanation", async () => {
    const r = await runImport({ ...fixture(), mode: "apply", startedBy: U.owner.id, environment: "test", source: "fixture" });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/Replace data from earlier imports/);
  });
  it("Excel workbook with Replace swaps the catalog, to-buy and unsorted rows", async () => {
    const { sheets } = await collectSheets([{ file: { name: "Madtown.xlsx", data: await xlsx() } }]);
    const base = {
      sheet1: sheets.sheet1!,
      toBuy: sheets.toBuy!,
      unsorted: sheets.unsorted!,
      fileRules: realRules as unknown as Rules,
      startedBy: U.owner.id,
      environment: "test",
      source: "xlsx",
    };
    const dry = await runImport({ ...base, mode: "dry-run", replace: true });
    expect(dry.error).toBeUndefined();
    expect((await svc<{ n: number }>("select count(*)::int n from items"))[0].n).toBe(103); // preview changed nothing
    const r = await runImport({ ...base, mode: "apply", replace: true });
    expect(r.error).toBeUndefined();
    expect(await svc("select id, type, quantity_mode, stock, status from items order by id")).toEqual([
      { id: "MTMH_101", type: "Camera", quantity_mode: "Single", stock: 1, status: "Available" },
      { id: "MTMH_191", type: "Accessory", quantity_mode: "Counted", stock: 20, status: "Available" },
      { id: "MTMH_208", type: "Hard Disk", quantity_mode: "Single", stock: 1, status: "Available" },
      { id: "MTMH_212", type: "Camera", quantity_mode: "Single", stock: 1, status: "Missing" },
    ]);
    const fx3 = await svc<{ file: string }>("select p.provider_file_id file from items i join photos p on p.id = i.latest_photo_id where i.id = 'MTMH_101'");
    expect(fx3[0].file).toBe("NEW");
    expect((await svc<{ n: number }>("select count(*)::int n from photos where item_id = 'MTMH_101'"))[0].n).toBe(3);
    expect(await svc("select status, decision_comment from wishlist_items")).toEqual([{ status: "Rejected", decision_comment: "Not needed (3 confirmed in photo)" }]);
    expect(await svc("select status, converted_item_ids from unsorted_items")).toEqual([{ status: "Converted", converted_item_ids: ["MTMH_208"] }]);
    expect((await svc<{ n: number }>("select count(*)::int n from loans where created_via = 'Import'"))[0].n).toBe(0);
  });
});
