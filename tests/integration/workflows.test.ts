import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, newItem, photo, personId, closePool, type Users } from "../helpers/db";

let U: Users;
let chiru: string;
beforeAll(async () => {
  U = await freshDb();
  chiru = await personId("Chiru");
});
afterAll(closePool);

const future = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();

describe("item ids (FR-CAT-001, AC-CAT-02)", () => {
  it("assigns MTMH_204, never reuses after retirement", async () => {
    const a = await newItem(U.manager, { name: "Test Light A", type: "Light" });
    expect(a).toBe("MTMH_204");
    await as(U.owner).wf("request_retirement", { item_id: a, kind: "Retired", reason: "test" });
    const b = await newItem(U.manager, { name: "Test Light B", type: "Light" });
    expect(b).toBe("MTMH_205");
    const st = await svc("select status, retired_at is not null as r from items where id=$1", [a]);
    expect(st[0]).toMatchObject({ status: "Retired", r: true });
  });
  it("ids are immutable and explicit ids from users are ignored", async () => {
    await expect(as(U.manager).q("update items set id='MTMH_999' where id='MTMH_205'")).rejects.toMatchObject({ code: "ITEM_ID_IMMUTABLE" });
    const r = await as(U.manager).q<{ id: string }>(
      "insert into items(id,name,type,quantity_mode,stock,condition,owner_person_id) values ('MTMH_150','X','Light','Single',1,'Good',(select id from people where is_madtown)) returning id",
    );
    expect(r[0].id).toBe("MTMH_206");
  });
  it("Staff cannot add items; Admin-only", async () => {
    await expect(as(U.team).wf("create_item", { name: "Nope", type: "Light" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
});

describe("check-out / check-in (FR-CHK)", () => {
  let cam: string;
  beforeAll(async () => {
    cam = await newItem(U.manager, { name: "Test Camera", type: "Camera" });
  });

  it("blocks Camera check-out without photo, then succeeds with one (AC-CHK-01 pattern)", async () => {
    await expect(as(U.team).wf("checkout", { item_id: cam, condition_out: "Good" })).rejects.toMatchObject({ code: "PHOTO_REQUIRED" });
    const ph = await photo(U.team, cam, "Check-out");
    // the due date is mandatory now (2026-11-24); the form pre-fills the type default (2 days for Camera, FR-CHK-002)
    await expect(as(U.team).wf("checkout", { item_id: cam, condition_out: "Good", photo_ids: [ph], due_at: null })).rejects.toMatchObject({ code: "DUE_REQUIRED" });
    const due = new Date(Date.now() + 2 * 86400_000).toISOString();
    const r = await as(U.team).wf<{ loan_id: string; due_at: string }>("checkout", { item_id: cam, condition_out: "Good", photo_ids: [ph], due_at: due });
    expect(r.loan_id).toBeTruthy();
    expect(new Date(r.due_at).toISOString()).toBe(due);
    const it = await svc("select status, holder_person_id from items where id=$1", [cam]);
    expect(it[0].status).toBe("Checked out");
    expect(it[0].holder_person_id).toBe(U.team.personId);
  });

  it("blocks a second check-out of the same Single item (AC-CHK-02)", async () => {
    const ph = await photo(U.manager, cam, "Check-out");
    await expect(as(U.manager).wf("checkout", { item_id: cam, borrower_person_id: chiru, condition_out: "Good", photo_ids: [ph] })).rejects.toMatchObject({ code: "ALREADY_OUT" });
  });

  it("Staff run the desk: they check out to any borrower and check in any loan (2026-11-24)", async () => {
    const tri = await newItem(U.manager, { name: "Test Tripod", type: "Tripod" });
    const r = await as(U.team).wf<{ loan_id: string }>("checkout", { item_id: tri, borrower_person_id: chiru, condition_out: "Good" });
    expect((await svc("select borrower_person_id, checked_out_by from loans where id=$1", [r.loan_id]))[0]).toEqual({ borrower_person_id: chiru, checked_out_by: U.team.id });
    await as(U.team2).wf("checkin", { loan_id: r.loan_id, condition_in: "Good" });
    expect((await svc("select status from loans where id=$1", [r.loan_id]))[0].status).toBe("Returned");
  });

  it("check-in worse condition flags prompt and can create linked repair (FR-CHK-005, AC-CHK-04)", async () => {
    const loan = (await svc<{ id: string }>("select l.id from loans l join loan_lines ll on ll.loan_id=l.id where ll.item_id=$1 and ll.active", [cam]))[0].id;
    await expect(as(U.team).wf("checkin", { loan_id: loan, condition_in: "Bad condition" })).rejects.toMatchObject({ code: "PHOTO_REQUIRED" });
    const ph = await photo(U.team, cam, "Check-in");
    const r = await as(U.team).wf<{ condition_worse: boolean; repair_ids: string[]; status: string }>("checkin", {
      loan_id: loan,
      condition_in: "Bad condition",
      photo_ids: [ph],
      damage: true,
      create_repair: true,
      damage_description: "Lens mount loose",
    });
    expect(r.condition_worse).toBe(true);
    expect(r.status).toBe("Returned");
    expect(r.repair_ids).toHaveLength(1);
    const m = await svc("select linked_loan_id, state from maintenance_events where id=$1", [r.repair_ids[0]]);
    expect(m[0]).toMatchObject({ linked_loan_id: loan, state: "Reported" });
    const it = await svc("select status, condition from items where id=$1", [cam]);
    expect(it[0]).toMatchObject({ status: "In repair", condition: "Bad condition" });
  });

  it("an item in repair cannot be checked out (FR-CON-004)", async () => {
    const ph = await photo(U.manager, cam, "Check-out");
    await expect(as(U.manager).wf("checkout", { item_id: cam, borrower_person_id: chiru, condition_out: "Bad condition", photo_ids: [ph] })).rejects.toMatchObject({
      code: "IN_REPAIR",
    });
  });

  it("repair lifecycle returns the item to Available with history (AC-CON-02)", async () => {
    const ev = (await svc<{ id: string }>("select id from maintenance_events where item_id=$1", [cam]))[0].id;
    for (const s of ["Sent for repair", "In repair", "Returned", "Closed"]) {
      await as(U.manager).wf("advance_maintenance", { event_id: ev, to_state: s, vendor: "Test Vendor", condition_after: "Good" });
    }
    await expect(as(U.manager).wf("advance_maintenance", { event_id: ev, to_state: "Reported" })).rejects.toMatchObject({ code: "BAD_TRANSITION" });
    const h = await svc("select to_state, by_user from maintenance_state_history where event_id=$1 order by at", [ev]);
    expect(h.map((x) => x.to_state)).toEqual(["Reported", "Sent for repair", "In repair", "Returned", "Closed"]);
    expect(h.every((x) => x.by_user)).toBe(true);
    const it = await svc("select status from items where id=$1", [cam]);
    expect(it[0].status).toBe("Available");
  });
});

describe("counted items (FR-CAT-006, FR-CHK-006, FR-CHK-011, AC-CHK-03)", () => {
  let bat: string;
  beforeAll(async () => {
    bat = await newItem(U.manager, { name: "Test Battery Pack", type: "Battery", quantity_mode: "Counted", stock: 6 });
  });
  it("checks out 5 of 6, blocks 2 more", async () => {
    await as(U.manager).wf("checkout", { item_id: bat, quantity: 5, borrower_person_id: chiru, condition_out: "Good" });
    await expect(as(U.manager).wf("checkout", { item_id: bat, quantity: 2, borrower_person_id: chiru, condition_out: "Good" })).rejects.toMatchObject({ code: "INSUFFICIENT_QTY" });
    const q = await svc("select * from app.item_quantities($1)", [bat]);
    expect(q[0]).toMatchObject({ available_qty: 1, out_qty: 5 });
  });
  it("partial check-in: 3 returned, 1 lost, 1 left open", async () => {
    const line = (await svc<{ id: string; loan_id: string }>("select id, loan_id from loan_lines where item_id=$1 and active", [bat]))[0];
    const r = await as(U.manager).wf<{ status: string; incident_ids: string[] }>("checkin", {
      loan_id: line.loan_id,
      lines: [{ line_id: line.id, returned: 3, lost: 1 }],
      condition_in: "Good",
      lost_place: "Test shoot",
    });
    expect(r.status).toBe("Open");
    expect(r.incident_ids).toHaveLength(1);
    const q = await svc("select * from app.item_quantities($1)", [bat]);
    expect(q[0]).toMatchObject({ available_qty: 4, out_qty: 1, lost_qty: 1 });
    const inc = await svc("select quantity, responsible_person_id, last_seen_place from incidents where id=$1", [r.incident_ids[0]]);
    expect(inc[0]).toMatchObject({ quantity: 1, responsible_person_id: chiru, last_seen_place: "Test shoot" });
  });
  it("holdings always add up to stock (DB constraint)", async () => {
    await expect(svc("update item_holdings set quantity = quantity + 1 where item_id=$1 and status='Available'", [bat])).rejects.toMatchObject({ code: "HOLDINGS_MISMATCH" });
  });
});

describe("overdue borrower (FR-CHK-007, D-05) and extensions (FR-CHK-009)", () => {
  it("team member with overdue items is blocked; Manager needs a reason", async () => {
    const tri = await newItem(U.manager, { name: "Overdue Tripod", type: "Tripod" });
    const r = await as(U.team2).wf<{ loan_id: string }>("checkout", { item_id: tri, condition_out: "Good", due_at: future(1) });
    await svc("update loans set checked_out_at = now() - interval '3 days', due_at = now() - interval '1 day' where id=$1", [r.loan_id]);
    await svc("select app.job_mark_overdue()");
    const other = await newItem(U.manager, { name: "Other Stand", type: "Stand" });
    await expect(as(U.team2).wf("checkout", { item_id: other, condition_out: "Good" })).rejects.toMatchObject({ code: "OVERDUE_BLOCKED" });
    await expect(as(U.manager).wf("checkout", { item_id: other, borrower_person_id: U.team2.personId, condition_out: "Good" })).rejects.toMatchObject({
      code: "OVERDUE_NEEDS_REASON",
    });
    const ok = await as(U.manager).wf<{ warnings: string[] }>("checkout", {
      item_id: other,
      borrower_person_id: U.team2.personId,
      condition_out: "Good",
      override_reason: "Urgent shoot, approved by Anand",
    });
    expect(ok.warnings).toContain("OVERDUE_OVERRIDDEN");
    // extension: team member once
    await as(U.team2).wf("extend_loan", { loan_id: r.loan_id, new_due_at: future(2), reason: "Shoot extended" });
    await expect(as(U.team2).wf("extend_loan", { loan_id: r.loan_id, new_due_at: future(4), reason: "again" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await as(U.manager).wf("extend_loan", { loan_id: r.loan_id, new_due_at: future(5), reason: "Manager ok" });
    const l = await svc("select status, extension_count from loans where id=$1", [r.loan_id]);
    expect(l[0]).toMatchObject({ status: "Open", extension_count: 2 });
    await expect(as(U.manager).wf("extend_loan", { loan_id: r.loan_id, new_due_at: future(6), reason: "" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });
});

describe("transfer keeps chain of custody (FR-CHK-008, AC-CHK-05)", () => {
  it("Anand -> Chiru in one step", async () => {
    const lens = await newItem(U.manager, { name: "Transfer Lens", type: "Lens" });
    const ph = await photo(U.manager, lens, "Check-out");
    const a = await as(U.manager).wf<{ loan_id: string }>("checkout", { item_id: lens, condition_out: "Good", photo_ids: [ph] });
    const t = await as(U.manager).wf<{ loan_id: string }>("transfer_loan", { loan_id: a.loan_id, to_person_id: chiru, reason: "Chiru takes it to the shoot" });
    const ev = await svc<{ event: string; person: string }>(
      "select e.event, p.name as person from loan_events e join people p on p.id = e.person_id where e.item_id=$1 order by e.at, e.event",
      [lens],
    );
    expect(ev.map((e) => e.event)).toEqual(["check-out", "transfer-in", "transfer-out"].sort((x, y) => (x === "check-out" ? -1 : y === "check-out" ? 1 : 0)));
    const it = await svc("select holder_person_id, status from items where id=$1", [lens]);
    expect(it[0]).toMatchObject({ holder_person_id: chiru, status: "Checked out" });
    const old = await svc("select status, close_reason, transferred_to_loan_id from loans where id=$1", [a.loan_id]);
    expect(old[0]).toMatchObject({ status: "Returned", close_reason: "Transferred", transferred_to_loan_id: t.loan_id });
    const active = await svc("select count(*)::int n from loan_lines where item_id=$1 and active", [lens]);
    expect(active[0].n).toBe(1);
  });
});

describe("back-dated check-in (FR-CHK-014)", () => {
  it("Manager only, with reason", async () => {
    const st = await newItem(U.manager, { name: "Backdate Stand", type: "Stand" });
    const r = await as(U.team).wf<{ loan_id: string }>("checkout", { item_id: st, condition_out: "Good" });
    await svc("update loans set checked_out_at = now() - interval '2 days' where id=$1", [r.loan_id]);
    const when = new Date(Date.now() - 86400_000).toISOString();
    await expect(as(U.manager).wf("checkin", { loan_id: r.loan_id, backdated_at: new Date(Date.now() - 5 * 86400_000).toISOString(), backdate_reason: "x" })).rejects.toMatchObject(
      { code: "BAD_DATE" },
    );
    await expect(as(U.team).wf("checkin", { loan_id: r.loan_id, backdated_at: when, backdate_reason: "x" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(as(U.manager).wf("checkin", { loan_id: r.loan_id, backdated_at: when })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await as(U.manager).wf("checkin", { loan_id: r.loan_id, backdated_at: when, backdate_reason: "Returned earlier, recorded late", condition_in: "Good" });
    const l = await svc("select checkin_backdated, checked_in_at from loans where id=$1", [r.loan_id]);
    expect(l[0].checkin_backdated).toBe(true);
    expect(new Date(l[0].checked_in_at as string).toISOString()).toBe(when);
  });
});

describe("kits (FR-KIT-002..004, AC-KIT-01/02)", () => {
  it("kit checks out as one unit and blocks incomplete check-in", async () => {
    const g = await newItem(U.manager, { name: "Kit Gimbal", type: "Accessory", subtype: "Gimbal" });
    const b = await newItem(U.manager, { name: "Kit Grip", type: "Accessory" });
    const t = await newItem(U.manager, { name: "Kit Twist", type: "Accessory" });
    const k = await as(U.manager).q<{ id: string }>("insert into kits(name) values ('Test gimbal set') returning id");
    expect(k[0].id).toMatch(/^KIT_\d{3}$/);
    for (const [i, id] of [g, b, t].entries()) await as(U.manager).q("insert into kit_items(kit_id,item_id,required,sort) values ($1,$2,true,$3)", [k[0].id, id, i]);
    const r = await as(U.manager).wf<{ loan_id: string }>("checkout", { kit_id: k[0].id, borrower_person_id: chiru, condition_out: "Good" });
    const st = await svc<{ status: string }>("select status from items where id = any($1)", [[g, b, t]]);
    expect(st.every((s) => s.status === "Checked out")).toBe(true);
    const lines = await svc<{ id: string; item_id: string }>("select id, item_id from loan_lines where loan_id=$1", [r.loan_id]);
    const payload = lines.map((l) => ({ line_id: l.id, returned: l.item_id === b ? 0 : 1 }));
    await expect(as(U.manager).wf("checkin", { loan_id: r.loan_id, lines: payload, condition_in: "Good" })).rejects.toMatchObject({ code: "KIT_INCOMPLETE" });
    const ok = await as(U.manager).wf<{ status: string }>("checkin", {
      loan_id: r.loan_id,
      lines: payload,
      complete: false,
      condition_in: "Good",
      missing_parts: [{ item_id: g, description: "Grip not returned" }],
    });
    expect(ok.status).toBe("Open");
    const mp = await svc("select count(*)::int n from missing_parts where item_id=$1", [g]);
    expect(mp[0].n).toBe(1);
  });
});

describe("lost and found (FR-LST, FR-LOAN-008, AC-LST-03 core)", () => {
  it("Manager marks loan lost; scanning then found returns it", async () => {
    const it = await newItem(U.manager, { name: "Lost Reflector", type: "Reflector" });
    const r = await as(U.manager).wf<{ loan_id: string }>("checkout", { item_id: it, borrower_person_id: chiru, condition_out: "Good" });
    await expect(as(U.team).wf("mark_loan_lost", { loan_id: r.loan_id, reason: "x" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    const lost = await as(U.manager).wf<{ incident_ids: string[] }>("mark_loan_lost", { loan_id: r.loan_id, reason: "Not returned after shoot" });
    const inc = await svc("select last_known_holder_person_id, linked_loan_id from incidents where id=$1", [lost.incident_ids[0]]);
    expect(inc[0]).toMatchObject({ last_known_holder_person_id: chiru, linked_loan_id: r.loan_id });
    expect((await svc("select status from items where id=$1", [it]))[0].status).toBe("Lost");
    await as(U.team).wf("mark_found", { item_id: it, place: "Office store room" });
    expect((await svc("select status from items where id=$1", [it]))[0].status).toBe("Available");
    const res = await svc("select resolution from incidents where id=$1", [lost.incident_ids[0]]);
    expect(res[0].resolution).toBe("Found");
  });
  it("a Staff report of loss marks Missing, not Lost (D-36); an Admin writes it off directly", async () => {
    const it = await newItem(U.manager, { name: "Missing Clamp", type: "Accessory" });
    const r = await as(U.team).wf<{ incident_id: string }>("report_incident", { item_id: it, type: "Loss", mark: "Lost", description: "Cannot find it" });
    expect((await svc("select status from items where id=$1", [it]))[0].status).toBe("Missing");
    await expect(as(U.team).wf("resolve_incident", { incident_id: r.incident_id, resolution: "Written off", note: "Gone" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    // with two roles there is no separate approver: an Admin's write-off resolves at once
    const p = await as(U.manager).wf<{ status: string }>("resolve_incident", { incident_id: r.incident_id, resolution: "Written off", note: "Gone" });
    expect(p.status).toBe("Resolved");
    expect((await svc("select status, retirement_kind from items where id=$1", [it]))[0]).toMatchObject({ status: "Retired", retirement_kind: "Written off" });
  });
});

describe("guards and audit (A5, FR-AUD-001, NFR-015, AC-AUD-01)", () => {
  it("workflow fields cannot be changed directly, even by Owner", async () => {
    const it = await newItem(U.manager, { name: "Guard Light", type: "Light" });
    await expect(as(U.owner).q("update items set status='Lost' where id=$1", [it])).rejects.toMatchObject({ code: "WORKFLOW_FIELD" });
    await expect(as(U.owner).q("update items set holder_person_id=(select id from people where name='Chiru') where id=$1", [it])).rejects.toMatchObject({ code: "WORKFLOW_FIELD" });
    await expect(
      as(U.owner).q("insert into loans(borrower_person_id, checked_out_at, due_at) values ((select id from people where name='Chiru'), now(), now()+interval '1 day')"),
    ).rejects.toThrow();
  });
  it("editing a name records who/when/before/after; nobody can edit the entry", async () => {
    const it = await newItem(U.manager, { name: "Audit Light", type: "Light" });
    await as(U.manager).q("update items set name='Audit Light Renamed' where id=$1", [it]);
    const log = await as(U.owner).q<{ id: number; actor_user_id: string; before_json: { name: string }; after_json: { name: string } }>(
      "select * from audit_log where table_name='items' and record_id=$1 and action='update' order by id desc limit 1",
      [it],
    );
    expect(log[0]).toMatchObject({ actor_user_id: U.manager.id, before_json: { name: "Audit Light" }, after_json: { name: "Audit Light Renamed" } });
    for (const who of [U.owner, U.manager, U.team, U.dev]) {
      await expect(as(who).q("update audit_log set reason='x' where id=$1", [log[0].id])).rejects.toThrow();
      await expect(as(who).q("delete from audit_log where id=$1", [log[0].id])).rejects.toThrow();
    }
    await expect(svc("update audit_log set reason='x' where id=$1", [log[0].id])).rejects.toThrow();
    expect((await as(U.manager).q("select * from audit_log")).length).toBeGreaterThan(0); // global log: every Admin
    expect(await as(U.team).q("select * from audit_log")).toHaveLength(0); // ... never Staff
    expect((await as(U.manager).q("select * from app.item_audit($1)", [it])).length).toBeGreaterThan(0); // item-level ok (D-03)
    expect(await as(U.team).q("select * from app.item_audit($1)", [it])).toHaveLength(0);
  });
});

describe("financial fields hidden from Staff (A5, NFR-004, AC-NFR-02 at DB level)", () => {
  it("Staff (including the developer) cannot read prices; Admins can", async () => {
    const it = await newItem(U.owner, { name: "Priced Lens", type: "Lens", purchase_price: 21999, vendor: "Kamal Imaging", notes: "Bought for Rs 21,999 incl GST" });
    expect(await as(U.team).q("select * from item_financials where item_id=$1", [it])).toHaveLength(0);
    expect(await as(U.dev).q("select * from item_financials where item_id=$1", [it])).toHaveLength(0);
    expect((await as(U.manager).q<{ purchase_price: string }>("select * from item_financials where item_id=$1", [it]))[0].purchase_price).toBe("21999.00");
    await expect(as(U.team).q("select notes from items where id=$1", [it])).rejects.toThrow(/permission denied/);
    const v = await as(U.team).q<{ notes: string }>("select notes from items_v where id=$1", [it]);
    expect(v[0].notes).not.toMatch(/21,999/);
    expect(v[0].notes).toMatch(/Rs ▒▒▒/);
    const m = await as(U.owner).q<{ notes: string }>("select notes from items_v where id=$1", [it]);
    expect(m[0].notes).toMatch(/21,999/);
  });
});
