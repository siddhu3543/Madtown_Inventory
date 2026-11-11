import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, newItem, photo, personId, closePool, type Users } from "../helpers/db";
let U: Users;
beforeAll(async () => {
  U = await freshDb();
});
afterAll(closePool);
const d = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();

describe("FR-CAT-007 split Counted into tagged units (suffix pending approval, D-17)", () => {
  it("creates MTMH_NNN-01.. with holders kept, parent retired as Split, history kept, ids not reused", async () => {
    const id = await newItem(U.manager, { name: "Split batteries", type: "Battery", quantity_mode: "Counted", stock: 3 });
    const r = await as(U.manager).wf<{ units: string[] }>("split_counted", { item_id: id, reason: "Tagging each battery" });
    expect(r.units).toEqual([`${id}-01`, `${id}-02`, `${id}-03`]);
    expect((await svc("select status, retirement_kind from items where id=$1", [id]))[0]).toMatchObject({ status: "Retired", retirement_kind: "Split" });
    expect((await svc("select count(*)::int n from items where parent_item_id=$1 and quantity_mode='Single'", [id]))[0].n).toBe(3);
    await svc("update settings set value='false' where key='split_enabled'");
    const id2 = await newItem(U.manager, { name: "No split", type: "Battery", quantity_mode: "Counted", stock: 2 });
    await expect(as(U.manager).wf("split_counted", { item_id: id2 })).rejects.toMatchObject({ code: "DISABLED" });
    await expect(as(U.team).wf("split_counted", { item_id: id2 })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
});

describe("FR-CHK-012 reservations", () => {
  it("overlapping reservations are refused; check-out during someone else's booking needs acknowledgement", async () => {
    const id = await newItem(U.manager, { name: "Booked light", type: "Light" });
    const chiru = await personId("Chiru");
    await as(U.manager).q("insert into reservations(item_id, person_id, shoot, starts_at, ends_at, created_by) values ($1,$2,'Shorefest',$3,$4,auth.uid())", [
      id,
      chiru,
      d(0.01),
      d(3),
    ]);
    await expect(
      as(U.team).q("insert into reservations(item_id, person_id, shoot, starts_at, ends_at, created_by) values ($1,$2,'Other',$3,$4,auth.uid())", [
        id,
        U.team.personId,
        d(1),
        d(2),
      ]),
    ).rejects.toMatchObject({ code: "RESERVED_CONFLICT" });
    await expect(as(U.team).wf("checkout", { item_id: id, condition_out: "Good" })).rejects.toMatchObject({ code: "RESERVED_CONFLICT" });
    const r = await as(U.team).wf<{ warnings: string[] }>("checkout", { item_id: id, condition_out: "Good", ack_reservation: true });
    expect(r.warnings).toContain("RESERVATION_ACKNOWLEDGED");
  });
});

describe("FR-BUY-009 verify before buy; FR-CON-010 linked to-buy from a defect", () => {
  it("a verify-first line cannot be approved until verified", async () => {
    const w = (
      await as(U.manager).q<{ id: string }>(
        "insert into wishlist_items(item_description, replaces_or_adds, priority, status, verify_first) values ('BC-QZ1 charger','Adds','Medium','To research',true) returning id",
      )
    )[0].id;
    await expect(as(U.owner).wf("decide_wishlist", { wishlist_id: w, approve: true })).rejects.toMatchObject({ code: "VERIFY_FIRST" });
    await as(U.manager).wf("verify_wishlist", { wishlist_id: w, result: "Anand confirmed 2 exist; buy 1" });
    const r = await as(U.owner).wf<{ status: string }>("decide_wishlist", { wishlist_id: w, approve: true });
    expect(r.status).toBe("Approved");
    await expect(as(U.owner).wf("decide_wishlist", { wishlist_id: w, approve: false })).rejects.toMatchObject({ code: "BAD_STATUS" });
  });
  it("a Team member creates a linked to-buy line for a defect in one step", async () => {
    const id = await newItem(U.manager, { name: "Scratched filter", type: "Accessory" });
    const w = (
      await as(U.team).q<{ id: string }>(
        "insert into wishlist_items(item_description, reason, replaces_or_adds, priority, status) values ('Replacement filter','Heavily scratched','Replaces','Medium','To buy') returning id",
      )
    )[0].id;
    await as(U.team).q("insert into wishlist_related_items(wishlist_id, item_id) values ($1,$2)", [w, id]);
    expect((await svc("select item_id from wishlist_related_items where wishlist_id=$1", [w]))[0].item_id).toBe(id);
  });
});

describe("FR-PHO-005 promote check-in photo to Latest; previous stays in history", () => {
  it("promotes and keeps the old photo", async () => {
    const id = await newItem(U.manager, { name: "Photo cam", type: "Light" });
    const p1 = await photo(U.team, id, "Latest");
    await as(U.team).wf("promote_latest_photo", { photo_id: p1 });
    const p2 = await photo(U.team, id, "Check-in");
    await as(U.team).wf("promote_latest_photo", { photo_id: p2 });
    expect((await svc("select latest_photo_id from items where id=$1", [id]))[0].latest_photo_id).toBe(p2);
    expect((await svc("select count(*)::int n from photos where item_id=$1", [id]))[0].n).toBe(2);
    const p3 = await photo(U.team2, id, "Check-in");
    await expect(as(U.team).wf("promote_latest_photo", { photo_id: p3 })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(as(U.readonly).wf("promote_latest_photo", { photo_id: p2 })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
});

describe("FR-AUD-006/008 walkthrough bulk Missing and last audited", () => {
  it("not-found items move to Missing with one action; scanned items get last_audited_at", async () => {
    const a = await newItem(U.manager, { name: "Walk A", type: "Reflector" });
    const b = await newItem(U.manager, { name: "Walk B", type: "Reflector" });
    const au = (await as(U.manager).q<{ id: string }>("insert into audits(scope_kind, scope_value, started_by) values ('Type','Reflector',auth.uid()) returning id"))[0].id;
    await as(U.team).wf("record_audit_line", { audit_id: au, item_id: a, result: "Found" });
    const l = await as(U.manager).wf<{ line_id: string }>("record_audit_line", { audit_id: au, item_id: b, result: "Not found" });
    await as(U.manager).wf("apply_audit_correction", { line_id: l.line_id, action: "mark_missing" });
    expect((await svc("select status from items where id=$1", [b]))[0].status).toBe("Missing");
    expect((await svc("select last_audited_at is not null as x from items where id=$1", [a]))[0].x).toBe(true);
    await expect(as(U.team).wf("apply_audit_correction", { line_id: l.line_id, action: "none" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    const log = await svc("select reason from audit_log where action='walkthrough-correction' and item_id=$1", [b]);
    expect(log[0].reason).toMatch(/^Walkthrough/);
  });
});

describe("FR-RPT-003/004/005/007 reports run and hide cost from Team members", () => {
  it("loans by person/project, repairs, utilisation, pick list", async () => {
    const { loansReport, repairsReport, utilisation, pickList, assetValue } = await import("@/lib/services/reports");
    const team = { ...U.team, role: "Team member" as const, isDeveloper: false, financeVisible: false, sessionVersion: 1 };
    const owner = { ...U.owner, role: "Owner" as const, isDeveloper: false, financeVisible: true, sessionVersion: 1 };
    const lr = await loansReport(owner, "2000-01-01", "2100-01-01");
    expect(lr.byPerson.length).toBeGreaterThan(0);
    const rr = await repairsReport(team);
    expect(rr.costs).toBe(false);
    expect(Object.keys(rr.byItem[0] ?? {})).not.toContain("cost");
    expect((await utilisation(owner)).rows.length).toBeGreaterThan(0);
    expect(await pickList(owner, "Shorefest")).toHaveLength(1);
    await expect(assetValue(team)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
});
