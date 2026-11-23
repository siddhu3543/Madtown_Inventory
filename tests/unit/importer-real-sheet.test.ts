import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildPlan, isPersonName, linkPhotos, mapUnsortedStatus, mapWishlistStatus, matchType, parseSheetDate, parseStock, TYPES } from "@/lib/importer/plan";
import { cellText, collectSheets, missingTabs } from "@/lib/importer/workbook";

const S1 = "Item ID,Item name,Model Number,Type,Stock,Links,Updated links,Notes,Condition,Posession,Checked Out For,Checked Out Date,Checked In Date\n";
const TB = "Item,Reason,Related item ID,Replaces or adds,Priority,Status,Notes\n";
const NS = "Item,What we know,Question,Who can answer,Status\n";

describe("real sheet quirks (export of Oct 2026)", () => {
  it("stock written as 1.0 / 20.0 is a whole number", () => {
    expect(parseStock("1.0")).toBe(1);
    expect(parseStock("20.0")).toBe(20);
    expect(parseStock("3")).toBe(3);
    expect(parseStock("1.5")).toBeNull();
    expect(parseStock("two")).toBeNull();
    const p = buildPlan(S1 + "MTMH_191,Clamps,,Accessory,20.0,,,,Good,Madtown,,,\nMTMH_101,Sony FX3,ILME-FX3,Camera,1.0,,,,Good,Madtown,,,\n", TB, NS, {});
    expect(p.items.map((i) => [i.quantity_mode, i.stock])).toEqual([
      ["Counted", 20],
      ["Single", 1],
    ]);
    expect(p.warnings.some((w) => w.code === "STOCK_BAD")).toBe(false);
  });
  it("types: case, plural and trailing spaces match; unknown types are created", () => {
    expect(matchType("Backdrops", TYPES)).toBe("Backdrop");
    expect(matchType("light accessory ", TYPES)).toBe("Light accessory");
    expect(matchType("Hard Disk", TYPES)).toBeNull();
    const p = buildPlan(S1 + "MTMH_208,SSD,,Hard Disk,1.0,,,,Good,Madtown,,,\nMTMH_209,SSD 2,,Hard Disk,1.0,,,,Good,Madtown,,,\n", TB, NS, {});
    expect(p.items.map((i) => i.type)).toEqual(["Hard Disk", "Hard Disk"]);
    expect(p.newTypes).toEqual(["Hard Disk"]);
  });
  it("dates as Sheets/Excel export them", () => {
    expect(parseSheetDate("2026-10-16 00:00:00")).toBe("2026-10-16T12:00:00+05:30");
    expect(parseSheetDate("16/10/2026")).toBe("2026-10-16T12:00:00+05:30");
    expect(parseSheetDate("46311")).toBe("2026-10-16T12:00:00+05:30");
  });
  it("several links in one cell: one photo each, the current one is primary", () => {
    const r = linkPhotos("https://drive.google.com/file/d/AAA/view\nhttps://drive.google.com/file/d/BBB/view\nPrevious photo: https://drive.google.com/file/d/OLD/view", "Latest");
    expect(r.photos.map((p) => [p.provider_file_id, p.primary])).toEqual([
      ["AAA", true],
      ["BBB", false],
      ["OLD", false],
    ]);
    expect(r.photos[2].note).toContain("Previous photo");
    expect(linkPhotos("lost", "Latest").photos[0]).toMatchObject({ link_kind: "text", legacy_text: "lost", primary: false });
  });
  it("Posession text is not turned into people", () => {
    expect(isPersonName("Anand")).toBe(true);
    expect(isPersonName("Not at office")).toBe(false);
    expect(isPersonName("Anand checking at home")).toBe(false);
    const p = buildPlan(S1 + 'MTMH_212,Nikon camera,,Camera,1.0,,,,,"Not at office, Anand checking at home",,,\n', TB, NS, {});
    expect(p.people).toEqual([]);
    expect(p.items[0].status).toBe("Missing");
    expect(p.items[0].to_verify_reasons.join()).toContain("Not at office");
  });
  it("free-text statuses on To buy and Not yet sorted", () => {
    expect(mapWishlistStatus("Not needed (3 confirmed in photo)")).toBe("Rejected");
    expect(mapWishlistStatus("To buy")).toBe("To buy");
    expect(mapUnsortedStatus("Added to sheet, MTMH_204")).toBe("Converted");
    expect(mapUnsortedStatus("Partly added: camera is MTMH_212")).toBe("To clarify");
    expect(mapUnsortedStatus("Resolved: it is the V1S bag, see MTMH_115")).toBe("Converted");
    const p = buildPlan(
      S1 + "MTMH_216,Roll pink,,Backdrops,1.0,,,,Good,Madtown,,,\nMTMH_217,Roll white,,Backdrops,1.0,,,,Good,Madtown,,,\n",
      TB + "Sony charger,Count,MTMH_197,Adds,Medium,Not needed (3 confirmed in photo),\n",
      NS + 'Paper backdrops,Rolls,How many?,Anand,"Added to sheet, MTMH_216 to MTMH_217 (2 rolls)"\n',
      {},
    );
    expect(p.wishlist[0]).toMatchObject({ status: "Rejected", sheet_status: "Not needed (3 confirmed in photo)" });
    expect(p.unsorted[0]).toMatchObject({ status: "Converted", converted_item_ids: ["MTMH_216", "MTMH_217"], duplicate_of: null });
  });
});

describe("Excel workbook upload", () => {
  async function workbook(tabs: Record<string, string>) {
    const wb = new ExcelJS.Workbook();
    for (const [name, file] of Object.entries(tabs)) {
      const ws = wb.addWorksheet(name);
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(0, 4);
      const Papa = (await import("papaparse")).default;
      for (const r of Papa.parse<string[]>(lines.join("\n")).data) ws.addRow(r.map((v) => (/^\d+$/.test(v) ? +v : v)));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  it("finds the three tabs by name, numbers come back as text", async () => {
    const data = await workbook({ Sheet1: "fixtures/sheet/Sheet1.csv", "To buy": "fixtures/sheet/To buy.csv", "Not yet sorted": "fixtures/sheet/Not yet sorted.csv" });
    const { sheets } = await collectSheets([{ file: { name: "Madtown Inventory.xlsx", data } }]);
    expect(missingTabs(sheets)).toEqual([]);
    expect(sheets.sheet1!.split("\n")[0]).toContain("Item ID,Item name");
    expect(sheets.toBuy!.split("\n")[0]).toContain("Item,Reason");
  });
  it("finds tabs by their headers when the tab names differ, and reports what is missing", async () => {
    const data = await workbook({ Inventory: "fixtures/sheet/Sheet1.csv", Purchases: "fixtures/sheet/To buy.csv" });
    const { sheets } = await collectSheets([{ file: { name: "export.xlsx", data } }]);
    expect(sheets.sheet1).not.toBeNull();
    expect(sheets.toBuy).not.toBeNull();
    expect(missingTabs(sheets)).toEqual(["Not yet sorted"]);
  });
  it("cell values: dates, hyperlinks, rich text", () => {
    expect(cellText(new Date(Date.UTC(2026, 9, 16)))).toBe("2026-10-16");
    expect(cellText({ text: "photo", hyperlink: "https://drive.google.com/file/d/X/view" } as ExcelJS.CellValue)).toBe("https://drive.google.com/file/d/X/view");
    expect(cellText({ richText: [{ text: "Good" }, { text: " one" }] } as ExcelJS.CellValue)).toBe("Good one");
    expect(cellText(1)).toBe("1");
  });
});
