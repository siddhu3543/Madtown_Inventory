import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, closePool, type Users } from "../helpers/db";
import { runImport } from "@/lib/importer/apply";
import { upkeepDue } from "@/lib/services/jobs";
let U: Users;
beforeAll(async () => {
  U = await freshDb();
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
});
afterAll(closePool);
const owner = () => ({ ...U.owner, role: "Owner" as const, isDeveloper: false, financeVisible: true, sessionVersion: 1 });

describe("remaining requirements", () => {
  it("FR-KIT-006: MTMH_119 battery and charger recorded as detached with Anand, parent not checked out", async () => {
    const r = await as(U.team).q<{ description: string; name: string }>(
      "select d.description, p.name from detached_accessories d join people p on p.id = d.holder_person_id where d.item_id='MTMH_119'",
    );
    expect(r[0]).toEqual({ description: "Battery and charger", name: "Anand" });
    expect((await svc("select status from items where id='MTMH_119'"))[0].status).toBe("Available");
  });
  it("FR-KIT-007 / FR-KIT-008: a Manager links the case an item travels in and records case capacity", async () => {
    await as(U.manager).q("update items set case_item_id = 'MTMH_190', case_capacity_note = 'Fits the drone and one battery' where id = 'MTMH_138'");
    expect((await as(U.team).q("select case_item_id, case_capacity_note from items_v where id='MTMH_138'"))[0]).toEqual({
      case_item_id: "MTMH_190",
      case_capacity_note: "Fits the drone and one battery",
    });
    expect((await svc("select needs_case from items where id='MTMH_120'"))[0].needs_case).toBe(true);
  });
  it("FR-QR-005: label goes on the pouch for tiny items", async () => {
    await as(U.manager).q("update items set label_target = 'Pouch', label_note = 'filter pouch' where id = 'MTMH_132'");
    expect((await as(U.team).q("select label_target from items_v where id='MTMH_132'"))[0].label_target).toBe("Pouch");
  });
  it("FR-LOAN-009 project per loan appears in the loans-by-project report (FR-RPT-003)", async () => {
    await as(U.team).wf("checkout", { item_id: "MTMH_185", condition_out: "Good", purpose: "Shorefest 2026" });
    const { loansReport } = await import("@/lib/services/reports");
    const r = await loansReport(owner(), "2000-01-01", "2100-01-01");
    expect(r.byProject.find((p) => p.project === "Shorefest 2026")?.loans).toBe(1);
  });
  it("FR-CON-006 / NTF-009: upkeep schedule per Type reminds 7 days before due", async () => {
    await as(U.manager).q("insert into maintenance_schedules(item_type, interval_days, next_due) values ('Camera', 180, '2027-03-10')");
    expect((await upkeepDue({ now: new Date("2027-02-20T04:00:00Z") })).sent).toBe(0);
    expect((await upkeepDue({ now: new Date("2027-03-04T04:00:00Z") })).sent).toBe(1);
    expect((await upkeepDue({ now: new Date("2027-03-05T04:00:00Z") })).sent).toBe(0);
  });
  it("FR-CON-009: total cost of ownership = purchase price + repairs (finance only)", async () => {
    await as(U.owner).wf("open_maintenance", { item_id: "MTMH_203", type: "Repair", issue_description: "Remote pairing", cost: 1500 });
    const { tco } = await import("@/lib/services/reports");
    const r = await tco(owner());
    expect(Number(r.find((x) => x.id === "MTMH_203")?.total)).toBe(23499);
  });
  it("FR-AUD-007: quick note per item during a walkthrough", async () => {
    const au = (await as(U.manager).q<{ id: string }>("insert into audits(scope_kind, started_by) values ('All', auth.uid()) returning id"))[0].id;
    await as(U.team).wf("record_audit_line", { audit_id: au, item_id: "MTMH_101", result: "Condition changed", note: "Strap frayed" });
    expect((await svc("select note from audit_lines where audit_id=$1", [au]))[0].note).toBe("Strap frayed");
  });
  it("FR-PHO-008: storage adapter round-trip (local implementation of the interface)", async () => {
    const { storage } = await import("@/lib/adapters/storage");
    const a = storage();
    const f = await a.put("MTMH_101", "t.jpg", Buffer.from("hello"), "image/jpeg");
    expect((await a.get(f.fileId)).bytes.toString()).toBe("hello");
    expect(f.folderId).toBe("MTMH_101");
  });
});
