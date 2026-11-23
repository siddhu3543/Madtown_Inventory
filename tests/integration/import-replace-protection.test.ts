/**
 * Replace must never take app history with it: items, tables and to-buy/unsorted rows touched in the app since the
 * earlier import block the replace (nothing deleted), while items created by hand in the app survive a replace.
 */
import { readFileSync } from "node:fs";
import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, newItem, closePool, type Users } from "../helpers/db";
import { runImport } from "@/lib/importer/apply";

let U: Users;
const fixture = () => ({
  sheet1: readFileSync("fixtures/sheet/Sheet1.csv", "utf8"),
  toBuy: readFileSync("fixtures/sheet/To buy.csv", "utf8"),
  unsorted: readFileSync("fixtures/sheet/Not yet sorted.csv", "utf8"),
  fileRules: JSON.parse(readFileSync("fixtures/mapping-rules.json", "utf8")),
  environment: "test",
  source: "fixture",
});
const reimport = (mode: "dry-run" | "apply") => runImport({ ...fixture(), mode, replace: true, startedBy: U.owner.id });
const count = async (sql: string) => (await svc<{ n: number }>(sql))[0].n;
/** an imported Single item at the office that needs no check-out photo */
const officeItem = async () =>
  (
    await svc<{ id: string }>(
      "select id from items where imported and status = 'Available' and quantity_mode = 'Single' and holder_location_id is not null and type not in ('Camera','Lens','Drone') order by id limit 1",
    )
  )[0].id;

beforeEach(async () => {
  U = await freshDb();
  const r = await runImport({ ...fixture(), mode: "apply", startedBy: U.owner.id });
  expect(r.error).toBeUndefined();
});
afterAll(closePool);

async function expectBlocked(ref: RegExp) {
  const before = { items: await count("select count(*)::int n from items"), loans: await count("select count(*)::int n from loans") };
  for (const mode of ["dry-run", "apply"] as const) {
    const r = await reimport(mode);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/Replace stopped — nothing was deleted/);
    expect(r.error).toMatch(ref);
  }
  expect({ items: await count("select count(*)::int n from items"), loans: await count("select count(*)::int n from loans") }).toEqual(before);
}

describe("Replace protects work done in the app", () => {
  it("untouched import: Replace succeeds and items made by hand in the app survive", async () => {
    const manual = await newItem(U.manager, { name: "Hand-added light stand", type: "Stand", quantity_mode: "Single", stock: 1 });
    const r = await reimport("apply");
    expect(r.error).toBeUndefined();
    expect(await count("select count(*)::int n from items where imported")).toBe(103);
    expect(await svc("select id, imported from items where id = $1", [manual])).toEqual([{ id: manual, imported: false }]);
  });
  it("a loan made in the app on an imported item blocks Replace", async () => {
    const id = await officeItem();
    await as(U.manager).wf("checkout", { item_id: id, borrower_person_id: U.team.personId, condition_out: "Good" });
    await expectBlocked(new RegExp(`loans made in the app: ${id}`));
    expect(await count(`select count(*)::int n from loans where created_via = 'App'`)).toBe(1);
  });
  it("a repair recorded on an imported item blocks Replace (found even without an App audit entry)", async () => {
    const id = await officeItem();
    // written by a background job, not the app: only the table check can see it
    await svc("insert into maintenance_events(item_id, type, state, issue_description) values ($1, 'Repair', 'Reported', 'Zoom ring sticks')", [id]);
    await expectBlocked(/repairs or services/);
    expect(await count("select count(*)::int n from maintenance_events where not legacy")).toBe(1);
  });
  it("an edit to an imported item, to-buy row or unsorted row blocks Replace", async () => {
    const id = await officeItem();
    await as(U.manager).q("update items set notes = 'Checked by Anand' where id = $1", [id]);
    await expectBlocked(new RegExp(`changed in the app: ${id}`));
  });
  it("a decision on an imported to-buy row blocks Replace", async () => {
    await as(U.owner).q("update wishlist_items set notes = 'Naveen: go ahead' where id = (select id from wishlist_items where legacy order by sheet_row limit 1)");
    await expectBlocked(/changed in the app: to-buy rows/);
  });
});
