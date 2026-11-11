/** Staging/local seed: test accounts (synthetic) + import of the synthetic sheet fixture. Never for production. */
import { readFileSync } from "node:fs";
import { loadEnv } from "./env";
loadEnv();
async function main() {
  if (process.env.APP_ENV === "production") throw new Error("seed refused in production");
  const { withService, pool } = await import("../src/lib/db");
  const { seedPeopleAndUsers } = await import("../src/lib/seed");
  const { runImport } = await import("../src/lib/importer/apply");
  const pw = process.env.SEED_PASSWORD ?? "madtown-staging-123";
  const users = await withService((c) => seedPeopleAndUsers(c, pw));
  console.log(
    "users:",
    Object.values(users)
      .map((u) => `${u.email} (${u.role})`)
      .join(", "),
    `password: ${pw}`,
  );
  const r = await runImport({
    sheet1: readFileSync("fixtures/sheet/Sheet1.csv", "utf8"),
    toBuy: readFileSync("fixtures/sheet/To buy.csv", "utf8"),
    unsorted: readFileSync("fixtures/sheet/Not yet sorted.csv", "utf8"),
    fileRules: JSON.parse(readFileSync("fixtures/mapping-rules.json", "utf8")),
    mode: "apply",
    startedBy: users.owner.id,
    environment: process.env.APP_ENV ?? "local",
    source: "fixtures/sheet (SYNTHETIC)",
  });
  console.log("import:", r.status, r.error ?? "", JSON.stringify(r.summary));
  await pool().end();
  if (r.status !== "succeeded") process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
