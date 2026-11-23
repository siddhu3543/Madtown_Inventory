/**
 * CLI: npm run import:sheet -- --mode dry-run|apply|final [--file workbook.xlsx | --dir fixtures/sheet] [--rules rules.json] [--replace]
 * --file: one Excel workbook with the tabs Sheet1, To buy, Not yet sorted.
 * --dir:  a folder with Sheet1.csv, "To buy.csv", "Not yet sorted.csv" (File > Download > CSV for each tab).
 * --replace: remove what earlier imports created before importing again.
 */
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadEnv } from "./env";
loadEnv();
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = (k: string) => process.argv.includes(`--${k}`);

async function main() {
  const { runImport } = await import("../src/lib/importer/apply");
  const { collectSheets, missingTabs } = await import("../src/lib/importer/workbook");
  const { pool } = await import("../src/lib/db");
  const file = arg("file");
  const dir = arg("dir", "fixtures/sheet")!;
  const mode = arg("mode", "dry-run") as "dry-run" | "apply" | "final";
  if (mode === "final" && process.env.APP_ENV !== "production") throw new Error("final mode is for the production import only (MIG-015); use apply on staging");
  let sheets: { sheet1: string | null; toBuy: string | null; unsorted: string | null };
  if (file) {
    const got = await collectSheets([{ file: { name: basename(file), data: readFileSync(file) } }]);
    console.log(got.notes.join("\n"));
    const missing = missingTabs(got.sheets);
    if (missing.length) throw new Error(`Workbook is missing: ${missing.join(", ")}`);
    sheets = got.sheets;
  } else
    sheets = {
      sheet1: readFileSync(join(dir, "Sheet1.csv"), "utf8"),
      toBuy: readFileSync(join(dir, "To buy.csv"), "utf8"),
      unsorted: readFileSync(join(dir, "Not yet sorted.csv"), "utf8"),
    };
  const isFixture = !file && resolve(dir) === resolve("fixtures/sheet");
  const rulesFile = arg("rules", isFixture ? "fixtures/mapping-rules.json" : "src/lib/importer/mapping-rules.json")!;
  const r = await runImport({
    sheet1: sheets.sheet1!,
    toBuy: sheets.toBuy!,
    unsorted: sheets.unsorted!,
    fileRules: JSON.parse(readFileSync(rulesFile, "utf8")),
    mode,
    replace: flag("replace"),
    startedBy: null,
    environment: process.env.APP_ENV ?? "local",
    source: file ?? dir,
  });
  console.log(JSON.stringify({ run: r.runId, status: r.status, error: r.error, summary: r.summary }, null, 2));
  const by: Record<string, number> = {};
  for (const w of r.warnings) by[`${w.level}:${w.code}`] = (by[`${w.level}:${w.code}`] ?? 0) + 1;
  console.log(by);
  await pool().end();
  if (r.status !== "succeeded") process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
