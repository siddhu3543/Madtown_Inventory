// Builds fixtures/sheet/fixture-workbook.xlsx (the SYNTHETIC fixture as one Excel workbook) for the upload tests.
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { readFileSync } from "node:fs";
const wb = new ExcelJS.Workbook();
for (const tab of ["Sheet1", "To buy", "Not yet sorted"]) {
  const ws = wb.addWorksheet(tab);
  for (const r of Papa.parse(readFileSync(`fixtures/sheet/${tab}.csv`, "utf8"), { skipEmptyLines: "greedy" }).data)
    ws.addRow(r.map((v) => (tab === "Sheet1" && /^\d+$/.test(v) ? +v : v)));
}
await wb.xlsx.writeFile("fixtures/sheet/fixture-workbook.xlsx");
