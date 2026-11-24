/**
 * Acceptance criteria that depend on imported sheet data (section 13), run on the SYNTHETIC fixture (D-34).
 * Re-run against the real export before sign-off.
 */
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, photo, personId, closePool, type Users } from "../helpers/db";
import { runImport } from "@/lib/importer/apply";

let U: Users;
const files = () => ({
  sheet1: readFileSync("fixtures/sheet/Sheet1.csv", "utf8"),
  toBuy: readFileSync("fixtures/sheet/To buy.csv", "utf8"),
  unsorted: readFileSync("fixtures/sheet/Not yet sorted.csv", "utf8"),
  fileRules: JSON.parse(readFileSync("fixtures/mapping-rules.json", "utf8")),
});
beforeAll(async () => {
  U = await freshDb();
  const dry = await runImport({ ...files(), mode: "dry-run", startedBy: U.owner.id, environment: "test", source: "fixture" });
  expect(dry.status).toBe("succeeded");
  expect((await svc("select count(*)::int n from items"))[0].n).toBe(0); // dry-run leaves nothing behind
  const r = await runImport({ ...files(), mode: "apply", startedBy: U.owner.id, environment: "test", source: "fixture" });
  expect(r.error).toBeUndefined();
});
afterAll(closePool);

describe("migration (G-09, MIG-001..016, NFR-016)", () => {
  it("AC-CAT-01: 103 items MTMH_101..MTMH_203, MTMH_145 stored without trailing space", async () => {
    const r = await svc<{ n: number; mn: string; mx: string }>("select count(*)::int n, min(id) mn, max(id) mx from items");
    expect(r[0]).toEqual({ n: 103, mn: "MTMH_101", mx: "MTMH_203" });
    expect(await svc("select id from items where id = 'MTMH_145'")).toHaveLength(1);
    expect(await svc("select id from items where id like '% %' or name <> btrim(name) or name ~ '\\s{2,}'")).toHaveLength(0);
  });
  it("FR-CAT-014 / MIG-014: sheet row and raw values kept per item", async () => {
    const r = await svc<{ sheet_row: number; legacy_raw: Record<string, string> }>("select sheet_row, legacy_raw from item_import_raw where item_id = 'MTMH_145'");
    expect(r[0].legacy_raw["Item ID"]).toBe("MTMH_145 ");
    expect(r[0].sheet_row).toBe(46);
  });
  it("NFR-016: imported rows are tagged source Import in the audit log", async () => {
    const r = await svc<{ source: string; n: number }>("select source, count(*)::int n from audit_log where table_name = 'items' and action = 'insert' group by 1");
    expect(r).toEqual([{ source: "Import", n: 103 }]);
  });
  it("MIG-015: a second import is refused once the catalog holds imported items", async () => {
    const r = await runImport({ ...files(), mode: "apply", startedBy: U.owner.id, environment: "test", source: "fixture" });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/already holds 103/);
  });
  it("AC-CAT-02 after import: the next new item is MTMH_204", async () => {
    const r = await as(U.manager).wf<{ item_id: string }>("create_item", { name: "Post-import item", type: "Light" });
    expect(r.item_id).toBe("MTMH_204");
  });
  it("Types normalised (11.2) and Accessory rows get a proposed subtype (FR-CAT-004)", async () => {
    expect(await svc("select id from items where type not in (select name from item_types)")).toHaveLength(0);
    expect((await svc<{ n: number }>("select count(*)::int n from items where type = 'Light accessory'"))[0].n).toBe(18);
    expect((await svc<{ n: number }>("select count(*)::int n from items where type = 'Accessory' and subtype is not null"))[0].n).toBe(44);
  });
});

describe("catalog ACs", () => {
  it("AC-CAT-03: searching FX3 returns MTMH_101 and MTMH_163..166 within 1 second", async () => {
    const { listItems } = await import("@/lib/services/items");
    const user = { ...U.team, role: "Staff" as const, isDeveloper: false, financeVisible: false, sessionVersion: 1 };
    const t0 = performance.now();
    const rows = await listItems(user, { q: "FX3" });
    const ms = performance.now() - t0;
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["MTMH_101", "MTMH_163", "MTMH_164", "MTMH_165", "MTMH_166"]));
    expect(ms).toBeLessThan(1000);
  });
  it("AC-CAT-04: MTMH_115 owner Anand, excluded from Madtown assets", async () => {
    const r = await as(U.team).q<{ owner_name: string; flag_owned_by_others: boolean; status: string }>(
      "select owner_name, flag_owned_by_others, status from items_v where id = 'MTMH_115'",
    );
    expect(r[0]).toMatchObject({ owner_name: "Anand", flag_owned_by_others: true, status: "Available" });
    const { assetValue } = await import("@/lib/services/reports");
    const owner = { ...U.owner, role: "Admin" as const, isDeveloper: false, financeVisible: true, sessionVersion: 1 };
    const av = await assetValue(owner);
    expect(av.items.map((i: { id: string }) => i.id)).not.toContain("MTMH_115");
    expect(av.excludedPersonal.map((i: { id: string }) => i.id)).toContain("MTMH_115");
  });
  it("AC-CAT-05: MTMH_202 appears in To verify with reason model TBD", async () => {
    const r = await as(U.team).q<{ flag_to_verify: boolean; to_verify_reason: string; model_number: string | null }>(
      "select flag_to_verify, to_verify_reason, model_number from items_v where id = 'MTMH_202'",
    );
    expect(r[0].flag_to_verify).toBe(true);
    expect(r[0].to_verify_reason).toMatch(/Model TBD/);
    expect(r[0].model_number).toBeNull();
  });
  it("FR-CAT-015: MTMH_197 stock TO VERIFY; MTMH_198..201 flagged", async () => {
    const r = await svc<{ id: string; stock_to_verify: boolean; to_verify: boolean }>(
      "select id, stock_to_verify, to_verify from items where id between 'MTMH_197' and 'MTMH_201' order by id",
    );
    expect(r.every((x) => x.stock_to_verify || x.to_verify)).toBe(true);
  });
  it("FR-CAT-006: MTMH_110 holdings 1 Madtown (office) and 1 Kittu", async () => {
    const r = await svc<{ who: string; quantity: number }>(`select coalesce(p.name, l.name) who, h.quantity from item_holdings h left join people p on p.id=h.holder_person_id
                       left join locations l on l.id=h.holder_location_id where h.item_id='MTMH_110' order by 1`);
    expect(r).toEqual([
      { who: "Kittu", quantity: 1 },
      { who: "Office", quantity: 1 },
    ]);
  });
});

describe("photos ACs", () => {
  it("AC-PHO-01: MTMH_104 shows both stock image and latest photo from the sheet links", async () => {
    const r = await as(U.team).q<{ s: string; l: string }>(
      `select s.provider_file_id s, l.provider_file_id l from items i join photos s on s.id = i.stock_image_photo_id join photos l on l.id = i.latest_photo_id where i.id = 'MTMH_104'`,
    );
    expect(r[0].s).toMatch(/^1SYN0104/);
    expect(r[0].l).toMatch(/^1SYN0104/);
  });
  it("AC-PHO-03 / FR-PHO-006: MTMH_187 is in Missing photos; folder links are flagged (FR-PHO-007)", async () => {
    const r = await as(U.team).q<{ id: string }>("select id from items_v where flag_missing_photos");
    const ids = r.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["MTMH_187", "MTMH_101", "MTMH_114"]));
    const f = await svc("select count(*)::int n from photos where link_kind = 'folder' and kind = 'Stock'");
    expect(f[0].n).toBe(6);
  });
});

describe("loans / lost / repair ACs on imported data", () => {
  it("AC-CON-01: MTMH_106 imports In repair and cannot be checked out", async () => {
    expect((await svc("select status from items where id='MTMH_106'"))[0].status).toBe("In repair");
    const ph = await photo(U.manager, "MTMH_106", "Check-out");
    await expect(
      as(U.manager).wf("checkout", { item_id: "MTMH_106", borrower_person_id: await personId("Chiru"), condition_out: "Bad condition", photo_ids: [ph] }),
    ).rejects.toMatchObject({ code: "IN_REPAIR" });
    const m = await svc("select state, cause from maintenance_events where item_id='MTMH_106' and type='Repair'");
    expect(m[0].state).toBe("Sent for repair");
    expect(m[0].cause).toMatch(/lens cells shifted/);
  });
  it("AC-CON-03: 101,102,103,105,107,108 each show a Service 14 July, year To verify", async () => {
    const r = await svc<{ item_id: string }>("select item_id from maintenance_events where type='Service' and year_to_verify and event_date_text like '14 Jul%' order by 1");
    expect(r.map((x) => x.item_id)).toEqual(["MTMH_101", "MTMH_102", "MTMH_103", "MTMH_105", "MTMH_107", "MTMH_108"]);
  });
  it("AC-LST-01: 111,123,139,159,162 Lost and excluded from available counts", async () => {
    const r = await as(U.team).q<{ id: string; available_qty: number; status: string }>(
      "select id, available_qty, status from items_v where id in ('MTMH_111','MTMH_123','MTMH_139','MTMH_159','MTMH_162')",
    );
    expect(r).toHaveLength(5);
    expect(r.every((x) => x.status === "Lost" && x.available_qty === 0)).toBe(true);
    const inc = await svc<{ item_id: string; history_known: boolean }>("select item_id, history_known from incidents where item_id in ('MTMH_111','MTMH_162')");
    expect(inc.every((x) => x.history_known === false)).toBe(true); // FR-LST-003
  });
  it("AC-LST-02: MTMH_145 stock 3 with 1 lost, last seen Shorefest, responsible Samuel", async () => {
    const q = await svc("select i.stock, q.lost_qty from items i, app.item_quantities(i.id) q where i.id='MTMH_145'");
    expect(q[0]).toMatchObject({ stock: 3, lost_qty: 1 });
    const inc = await svc<{ last_seen_place: string; name: string; quantity: number }>(
      "select i.last_seen_place, p.name, i.quantity from incidents i join people p on p.id = i.responsible_person_id where i.item_id='MTMH_145'",
    );
    expect(inc[0]).toEqual({ last_seen_place: "Shorefest", name: "Samuel", quantity: 1 });
  });
  it("AC-LOAN-02: legacy loan of MTMH_126 to Purushotham is open on his profile", async () => {
    const { personProfile } = await import("@/lib/services/loans");
    const owner = { ...U.owner, role: "Admin" as const, isDeveloper: false, financeVisible: true, sessionVersion: 1 };
    const d = await personProfile(owner, await personId("Purushotham"));
    const open = d!.loans.filter((l) => l.status === "Open");
    expect(open.some((l) => l.items.includes("MTMH_126") && l.legacy)).toBe(true);
  });
  it("AC-LOAN-03: Chiru shows the returned MTMH_103 loan and the MTMH_148 holding", async () => {
    const { personProfile } = await import("@/lib/services/loans");
    const owner = { ...U.owner, role: "Admin" as const, isDeveloper: false, financeVisible: true, sessionVersion: 1 };
    const d = await personProfile(owner, await personId("Chiru"));
    expect(d!.loans.some((l) => l.items.includes("MTMH_103") && l.status === "Returned")).toBe(true);
    expect(d!.holdings.some((h) => h.item_id === "MTMH_148")).toBe(true);
    const ret = d!.loans.find((l) => l.items.includes("MTMH_103"))!;
    expect(new Date(ret.checked_in_at).toISOString().slice(0, 10)).toBe("2026-10-16"); // FR-CHK-014 example date
  });
  it("AC-KIT-03: MTMH_109 shows a missing charging cable linked to the to-buy line", async () => {
    // to-buy is Admin-only since 2026-11-24
    const r = await as(U.manager).q<{ description: string; item_description: string }>(
      "select m.description, w.item_description from missing_parts m join wishlist_items w on w.id = m.wishlist_id where m.item_id = 'MTMH_109'",
    );
    expect(r[0].description).toMatch(/charging cable/i);
    expect(r[0].item_description).toBe("DJI Mic 2 charging cable");
  });
  it("AC-BUY-01: 25 To buy lines with priority and status; hard case line on MTMH_106", async () => {
    expect((await svc("select count(*)::int n from wishlist_items"))[0].n).toBe(25);
    const r = await as(U.manager).q(
      "select w.item_description, w.priority, w.status from wishlist_related_items r join wishlist_items w on w.id = r.wishlist_id where r.item_id = 'MTMH_106'",
    );
    expect(r).toEqual(expect.arrayContaining([expect.objectContaining({ item_description: "Hard camera and lens case", priority: "High", status: "To buy" })]));
  });
  it("MIG-012/013: 10 unsorted rows; SanDisk held as possible duplicate of MTMH_187", async () => {
    expect((await svc("select count(*)::int n from unsorted_items"))[0].n).toBe(10);
    const r = await svc("select duplicate_of_item_id from unsorted_items where item like 'SanDisk%'");
    expect(r[0].duplicate_of_item_id).toBe("MTMH_187");
  });
  it("FR-CAT-012: MTMH_203 purchase details parsed and hidden from Team members", async () => {
    expect(await as(U.team).q("select * from item_financials where item_id='MTMH_203'")).toHaveLength(0);
    const r = await as(U.owner).q<{ vendor: string; order_ref: string; purchase_price: string }>(
      "select vendor, order_ref, purchase_price from item_financials where item_id='MTMH_203'",
    );
    expect(r[0]).toEqual({ vendor: "Kamal Imaging", order_ref: "KI/SO/30101", purchase_price: "21999.00" });
    const notes = await as(U.team).q<{ notes: string }>("select notes from items_v where id='MTMH_203'");
    expect(notes[0].notes).not.toMatch(/21,999/);
    const o = await as(U.owner).q<{ order_ref: string; status: string }>("select order_ref, status from orders order by order_ref");
    expect(o).toEqual([
      { order_ref: "KI/SO/30093", status: "Cancelled" },
      { order_ref: "KI/SO/30101", status: "Delivered" },
    ]);
  });
  it("G-01: no Single item has two active holders; every active item has a holder or a status", async () => {
    expect(
      await svc("select item_id from loan_lines ll join items i on i.id = ll.item_id where ll.active and i.quantity_mode='Single' group by 1 having count(*) > 1"),
    ).toHaveLength(0);
    expect(
      await svc(
        "select id from items where quantity_mode='Single' and status in ('Available','Checked out','In repair') and holder_person_id is null and holder_location_id is null",
      ),
    ).toHaveLength(0);
  });
});

describe("check-out ACs on imported IDs", () => {
  it("AC-CHK-01/02: MTMH_103 needs a photo; then a second check-out is blocked", async () => {
    await expect(as(U.team).wf("checkout", { item_id: "MTMH_103", condition_out: "Good" })).rejects.toMatchObject({ code: "PHOTO_REQUIRED" });
    const ph = await photo(U.team, "MTMH_103", "Check-out");
    await as(U.team).wf("checkout", { item_id: "MTMH_103", condition_out: "Good", photo_ids: [ph] });
    expect((await svc("select status from items where id='MTMH_103'"))[0].status).toBe("Checked out");
    const ph2 = await photo(U.manager, "MTMH_103", "Check-out");
    await expect(as(U.manager).wf("checkout", { item_id: "MTMH_103", borrower_person_id: await personId("Chiru"), condition_out: "Good", photo_ids: [ph2] })).rejects.toMatchObject(
      { code: "ALREADY_OUT" },
    );
  });
  it("AC-CHK-04: check-in of MTMH_103 in Bad condition creates a repair linked to the loan", async () => {
    const loan = (await svc<{ loan_id: string }>("select loan_id from loan_lines where item_id='MTMH_103' and active"))[0].loan_id;
    const ph = await photo(U.team, "MTMH_103", "Check-in");
    const r = await as(U.team).wf<{ condition_worse: boolean }>("checkin", { loan_id: loan, condition_in: "Bad condition", photo_ids: [ph] });
    expect(r.condition_worse).toBe(true); // UI prompts for one-tap repair
    await as(U.manager).wf("open_maintenance", { item_id: "MTMH_103", type: "Repair", issue_description: "Worse at check-in", linked_loan_id: loan });
    expect((await svc("select linked_loan_id from maintenance_events where item_id='MTMH_103' and type='Repair'"))[0].linked_loan_id).toBe(loan);
  });
  it("AC-CHK-03: 5 of MTMH_141 (stock 6) succeeds; 2 more blocked", async () => {
    await as(U.manager).wf("checkout", { item_id: "MTMH_141", quantity: 5, borrower_person_id: await personId("Chiru"), condition_out: "Good" });
    await expect(as(U.manager).wf("checkout", { item_id: "MTMH_141", quantity: 2, borrower_person_id: await personId("Chiru"), condition_out: "Good" })).rejects.toMatchObject({
      code: "INSUFFICIENT_QTY",
    });
  });
  it("AC-CHK-05: transfer Anand -> Chiru keeps one chain of custody on the item", async () => {
    const r = await as(U.manager).wf<{ loan_id: string }>("checkout", { item_id: "MTMH_163", condition_out: "Good" }); // Anand checks out to himself
    await as(U.manager).wf("transfer_loan", { loan_id: r.loan_id, to_person_id: await personId("Chiru"), reason: "Hand-over at the shoot" });
    const ev = await svc<{ event: string; name: string }>(
      "select e.event, p.name from loan_events e join people p on p.id = e.person_id where e.item_id='MTMH_163' order by e.at, e.event",
    );
    expect(ev.map((e) => e.event)).toEqual(["check-out", "transfer-in", "transfer-out"]);
    expect((await svc("select p.name from items i join people p on p.id=i.holder_person_id where i.id='MTMH_163'"))[0].name).toBe("Chiru");
  });
  it("AC-AUD-01: editing MTMH_112's name records who/when/before/after", async () => {
    await as(U.manager).q("update items set name = 'Synthetic Light 112 (renamed)' where id = 'MTMH_112'");
    const r = await as(U.owner).q<{ actor_user_id: string; before_json: { name: string }; after_json: { name: string }; at: string }>(
      "select * from audit_log where record_id='MTMH_112' and action='update' and table_name='items' order by id desc limit 1",
    );
    expect(r[0].actor_user_id).toBe(U.manager.id);
    expect(r[0].before_json.name).toBe("Synthetic Light 112");
    expect(r[0].after_json.name).toBe("Synthetic Light 112 (renamed)");
  });
});
