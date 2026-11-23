/**
 * Turns uploaded sheet files into the three CSV texts the planner reads (Sheet1, To buy, Not yet sorted).
 * Accepts either one Excel workbook (.xlsx) holding the three tabs, or one file per tab (.csv or .xlsx).
 * Tabs are matched by name first and by their header row second, so a renamed tab still lands in the right place.
 */
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { SHEET1_HEADERS, TOBUY_HEADERS, UNSORTED_HEADERS } from "./plan";

export type TabKey = "sheet1" | "toBuy" | "unsorted";
export type SheetTexts = Record<TabKey, string | null>;
export type UploadedFile = { name: string; data: Buffer };

const TAB_LABEL: Record<TabKey, string> = { sheet1: "Sheet1 (items)", toBuy: "To buy", unsorted: "Not yet sorted" };
const HEADERS: Record<TabKey, string[]> = { sheet1: SHEET1_HEADERS, toBuy: TOBUY_HEADERS, unsorted: UNSORTED_HEADERS };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const NAME_HINTS: Record<TabKey, string[]> = {
  sheet1: ["sheet1", "items", "inventory", "items inventory"].map(norm),
  toBuy: ["to buy", "tobuy", "wishlist", "to-buy"].map(norm),
  unsorted: ["not yet sorted", "unsorted", "notsorted"].map(norm),
};

export function isXlsx(f: UploadedFile) {
  // .xlsx is a zip: PK\x03\x04
  return /\.xls[xm]$/i.test(f.name) || (f.data.length > 3 && f.data[0] === 0x50 && f.data[1] === 0x4b && f.data[2] === 0x03 && f.data[3] === 0x04);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Excel cell value -> the text the CSV export would have held */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(10));
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) {
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds();
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return hasTime ? `${d} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}` : d;
  }
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("hyperlink" in v) {
      const text = cellText((v as { text?: ExcelJS.CellValue }).text ?? "");
      const link = String((v as { hyperlink?: string }).hyperlink ?? "");
      return /^https?:\/\//i.test(text) || !/^https?:\/\//i.test(link) ? text || link : link;
    }
    if ("formula" in v || "sharedFormula" in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? "");
    if ("error" in v) return "";
  }
  return String(v);
}

function worksheetRows(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    rows[n - 1] = cells;
  });
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  // drop trailing empty columns (common when a sheet was formatted wider than its data)
  let last = 0;
  for (const r of rows)
    for (let c = r.length - 1; c >= 0; c--)
      if (r[c].trim()) {
        last = Math.max(last, c + 1);
        break;
      }
  return rows.map((r) => r.slice(0, last)).filter((r, i) => i === 0 || r.some((x) => x.trim()));
}

/** The tab whose header row best matches the expected headers (or null) */
function classifyByHeader(header: string[]): TabKey | null {
  const h = new Set(header.map((x) => x.trim()));
  let best: TabKey | null = null;
  let bestScore = 0;
  for (const k of Object.keys(HEADERS) as TabKey[]) {
    const score = HEADERS[k].filter((x) => h.has(x)).length / HEADERS[k].length;
    if (score > bestScore) [best, bestScore] = [k, score];
  }
  return bestScore >= 0.6 ? best : null;
}

function classifyByName(name: string): TabKey | null {
  const n = norm(name.replace(/\.(csv|xlsx|xlsm)$/i, ""));
  for (const k of Object.keys(NAME_HINTS) as TabKey[]) if (NAME_HINTS[k].some((h) => n === h || n.endsWith(h))) return k;
  return null;
}

const toCsv = (rows: string[][]) => Papa.unparse(rows, { newline: "\n" });

export async function workbookTabs(data: Buffer): Promise<{ name: string; rows: string[][] }[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch (e) {
    throw new Error(`Could not read the Excel file (${(e as Error).message}). Save it as .xlsx (Excel Workbook) and try again.`);
  }
  return wb.worksheets.filter((ws) => ws.state !== "veryHidden").map((ws) => ({ name: ws.name, rows: worksheetRows(ws) }));
}

/**
 * Collects the three tab texts from any mix of uploads. `hint` is the form field a file came from
 * (used when a CSV's name and headers do not say which tab it is).
 */
export async function collectSheets(files: { file: UploadedFile; hint?: TabKey }[]): Promise<{ sheets: SheetTexts; notes: string[] }> {
  const sheets: SheetTexts = { sheet1: null, toBuy: null, unsorted: null };
  const notes: string[] = [];
  const put = (k: TabKey, text: string, from: string) => {
    if (sheets[k]) notes.push(`${TAB_LABEL[k]} found again in ${from}; the first one was used`);
    else {
      sheets[k] = text;
      notes.push(`${TAB_LABEL[k]} read from ${from}`);
    }
  };
  for (const { file, hint } of files) {
    if (isXlsx(file)) {
      const tabs = await workbookTabs(file.data);
      const nonEmpty = tabs.filter((t) => t.rows.length && t.rows[0].some((x) => x.trim()));
      for (const t of nonEmpty) {
        const k = classifyByName(t.name) ?? classifyByHeader(t.rows[0]) ?? (nonEmpty.length === 1 ? (hint ?? null) : null);
        if (k) put(k, toCsv(t.rows), `${file.name} › ${t.name}`);
        else notes.push(`Tab "${t.name}" in ${file.name} was ignored (name and headers match none of Sheet1, To buy, Not yet sorted)`);
      }
    } else {
      const text = file.data.toString("utf8").replace(/^﻿/, "");
      const first = Papa.parse<string[]>(text, { preview: 1 }).data[0] ?? [];
      const k = classifyByHeader(first) ?? classifyByName(file.name) ?? hint ?? null;
      if (k) put(k, text, file.name);
      else notes.push(`${file.name} was ignored (headers match none of Sheet1, To buy, Not yet sorted)`);
    }
  }
  return { sheets, notes };
}

export function missingTabs(s: SheetTexts): string[] {
  return (Object.keys(s) as TabKey[]).filter((k) => !s[k]).map((k) => TAB_LABEL[k]);
}
