/**
 * CLI: npm run import:sheet -- --mode dry-run|apply|final [--dir fixtures/sheet] [--rules fixtures/mapping-rules.json]
 * Expects Sheet1.csv, "To buy.csv", "Not yet sorted.csv" (File > Download > CSV for each tab).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./env";
loadEnv();
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};

async function main() {
  const { runImport } = await import("../src/lib/importer/apply");
  const { pool } = await import("../src/lib/db");
  const dir = arg("dir", "fixtures/sheet")!;
  const mode = arg("mode", "dry-run") as "dry-run" | "apply" | "final";
  if (mode === "final" && process.env.APP_ENV !== "production") throw new Error("final mode is for the production import only (MIG-015); use apply on staging");
  const r = await runImport({
    sheet1: readFileSync(join(dir, "Sheet1.csv"), "utf8"),
    toBuy: readFileSync(join(dir, "To buy.csv"), "utf8"),
    unsorted: readFileSync(join(dir, "Not yet sorted.csv"), "utf8"),
    fileRules: JSON.parse(readFileSync(arg("rules", "fixtures/mapping-rules.json")!, "utf8")),
    mode,
    startedBy: null,
    environment: process.env.APP_ENV ?? "local",
    source: dir,
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
