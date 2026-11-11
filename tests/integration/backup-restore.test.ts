/** NFR-010 / AC-NFR-03 restore drill, locally: dump -> restore into a scratch database -> counts and constraints match. */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { Client } from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { freshDb, svc, closePool } from "../helpers/db";
import { runImport } from "@/lib/importer/apply";

const SRC = "postgres://postgres@127.0.0.1:54322/madtown_test",
  DST = "postgres://postgres@127.0.0.1:54322/madtown_restore_drill";
beforeAll(async () => {
  const U = await freshDb();
  await runImport({
    sheet1: readFileSync("fixtures/sheet/Sheet1.csv", "utf8"),
    toBuy: readFileSync("fixtures/sheet/To buy.csv", "utf8"),
    unsorted: readFileSync("fixtures/sheet/Not yet sorted.csv", "utf8"),
    fileRules: JSON.parse(readFileSync("fixtures/mapping-rules.json", "utf8")),
    mode: "apply",
    startedBy: U.owner.id,
    environment: "test",
    source: "fixture",
  });
  const c = new Client({ connectionString: "postgres://postgres@127.0.0.1:54322/postgres" });
  await c.connect();
  await c.query("drop database if exists madtown_restore_drill");
  await c.query("create database madtown_restore_drill");
  await c.end();
});
afterAll(closePool);

it("a dump restores into staging with identical counts, working constraints and an intact audit log", async () => {
  mkdirSync(".backups-test", { recursive: true });
  const file = execFileSync("bash", ["scripts/backup.sh", SRC, ".backups-test"]).toString().trim().split("\n").pop()!;
  execFileSync("bash", ["scripts/restore-to-staging.sh", file, DST], { stdio: "pipe" });
  const tables = ["items", "item_holdings", "loans", "loan_lines", "photos", "incidents", "maintenance_events", "wishlist_items", "unsorted_items", "audit_log", "users"];
  const d = new Client({ connectionString: DST });
  await d.connect();
  try {
    for (const t of tables) {
      const a = (await svc<{ n: number }>(`select count(*)::int n from ${t}`))[0].n;
      const b = (await d.query(`select count(*)::int n from public.${t}`)).rows[0].n;
      expect(b, t).toBe(a);
    }
    await expect(d.query("update public.audit_log set reason = 'x' where id = 1")).rejects.toThrow(/append-only/); // immutability survives restore
    await expect(d.query("update public.item_holdings set quantity = quantity + 1 where item_id = 'MTMH_141'")).rejects.toThrow(/HOLDINGS_MISMATCH/);
    expect((await d.query("select next_value from public.id_counters where name = 'item'")).rows[0].next_value).toBe(204);
    // privileges and RLS survive: authenticated may read items_v but not raw notes; RLS still enabled
    expect(
      (await d.query("select has_table_privilege('authenticated','public.items_v','select') a, has_column_privilege('authenticated','public.items','notes','select') b")).rows[0],
    ).toEqual({ a: true, b: false });
    expect((await d.query("select relrowsecurity from pg_class where oid = 'public.item_financials'::regclass")).rows[0].relrowsecurity).toBe(true);
  } finally {
    await d.end();
  }
});
