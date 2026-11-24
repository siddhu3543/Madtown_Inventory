/**
 * A5: "Test access through both the UI and direct API/database requests for every role."
 * Direct SQL as each role (the same path Supabase's Data API would use with a user's JWT): Admin and Staff (2026-11-24).
 */
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, closePool, type Users } from "../helpers/db";
import { runImport } from "@/lib/importer/apply";

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
  await svc("insert into maintenance_costs(event_id, cost) select id, 1500 from maintenance_events where item_id = 'MTMH_106'");
  await svc("insert into wishlist_options(wishlist_id, vendor, price) select id, 'Pooja Electronics', 8500 from wishlist_items where sheet_row = 5");
});
afterAll(closePool);

const count = async (u: Users[keyof Users], sql: string) => (await as(u).q<{ n: number }>(`select count(*)::int n from (${sql}) x`))[0].n;
/** owner and manager are both Admins now; team, team2 and dev are Staff (dev also has the developer flag) */
const roles = ["owner", "manager", "team", "team2", "dev"] as const;
const ADMINS = ["owner", "manager"] as const;
const STAFF = ["team", "team2", "dev"] as const;

describe("two roles only (2026-11-24)", () => {
  it("every account is Admin or Staff, and the database refuses any other role", async () => {
    expect((await svc<{ role: string }>("select distinct role from users order by role")).map((r) => r.role)).toEqual(["Admin", "Staff"]);
    for (const old of ["Owner", "Manager", "Team member", "Read-only"])
      await expect(svc("update users set role = $1 where id = $2", [old, U.team.id])).rejects.toThrow(/users_role_check/);
  });
});

describe("financial data (D-04, NFR-004): Admins only", () => {
  const FIN = [
    "select * from item_financials",
    "select * from maintenance_costs",
    "select * from order_financials",
    "select * from wishlist_options",
    "select * from wishlist_financials where estimated_cost is not null or legacy_raw is not null",
  ];
  const expectVisible = { owner: true, manager: true, team: false, team2: false, dev: false };
  for (const r of roles)
    it(`${r}: financial tables ${expectVisible[r] ? "visible" : "hidden"}`, async () => {
      for (const q of FIN) {
        const n = await count(U[r], q);
        if (expectVisible[r]) expect(n, q).toBeGreaterThan(0);
        else expect(n, q).toBe(0);
      }
    });
  it("a Staff account cannot be given finance access by the old per-user switch", async () => {
    await svc("update users set finance_access = 'on' where id = $1", [U.team2.id]);
    expect(await count(U.team2, "select * from item_financials")).toBe(0);
    await svc("update users set finance_access = 'default' where id = $1", [U.team2.id]);
  });
  it("no role can read raw notes directly; masked via items_v unless finance", async () => {
    for (const r of roles) await expect(as(U[r]).q("select notes from items limit 1")).rejects.toThrow(/permission denied/);
    expect((await as(U.team).q<{ notes: string }>("select notes from items_v where id = 'MTMH_203'"))[0].notes).toMatch(/Rs ▒▒▒/);
    expect((await as(U.manager).q<{ notes: string }>("select notes from items_v where id = 'MTMH_203'"))[0].notes).toMatch(/21,999/);
  });
  it("guessed ids do not leak prices through joins or functions", async () => {
    const id = (await svc<{ id: string }>("select id from orders limit 1"))[0].id;
    expect(await as(U.team).q("select * from order_financials where order_id = $1", [id])).toHaveLength(0);
    expect(await as(U.team).q("select * from orders where id = $1", [id])).toHaveLength(0); // Staff cannot see orders at all
    expect(await as(U.team).q("select * from app.item_audit('MTMH_203')")).toHaveLength(0);
  });
  it("legacy raw sheet values (may contain prices) are finance or developer only", async () => {
    expect(await count(U.team, "select * from item_import_raw")).toBe(0);
    expect(await count(U.dev, "select * from item_import_raw")).toBe(103);
  });
});

describe("Staff run the desk; everything else is Admin (2026-11-24)", () => {
  it("Staff can read what the desk needs: items, loans, people, kits", async () => {
    for (const r of STAFF) {
      expect(await count(U[r], "select * from items_v"), r).toBe(103);
      expect(await count(U[r], "select * from loans"), r).toBeGreaterThan(0);
      expect(await count(U[r], "select * from people"), r).toBeGreaterThan(0);
    }
  });
  it("to-buy, orders and reservations are Admin-only (read and write)", async () => {
    for (const r of STAFF) {
      expect(await count(U[r], "select id from wishlist_items"), r).toBe(0);
      expect(await count(U[r], "select wishlist_id from wishlist_related_items"), r).toBe(0);
      expect(await count(U[r], "select id from orders"), r).toBe(0);
      await expect(
        as(U[r]).q("insert into wishlist_items(item_description, replaces_or_adds, priority, status) values ('Staff idea','Adds','Low','To research')"),
        r,
      ).rejects.toThrow(/row-level security|permission/);
      await expect(
        as(U[r]).q(
          "insert into reservations(item_id, person_id, starts_at, ends_at, created_by, status) values ('MTMH_110', $1, now() + interval '1 day', now() + interval '2 day', auth.uid(), 'Active')",
          [U[r].personId],
        ),
        r,
      ).rejects.toThrow(/row-level security|permission/);
    }
    for (const r of ADMINS) expect(await count(U[r], "select id from wishlist_items"), r).toBeGreaterThan(0);
  });
  it("walkthrough counting, repairs, stock and custody changes are Admin-only", async () => {
    for (const r of STAFF) {
      await expect(as(U[r]).wf("record_audit_line", { audit_id: "00000000-0000-0000-0000-000000000000", item_id: "MTMH_110" }), r).rejects.toMatchObject({ code: "NOT_ALLOWED" });
      await expect(as(U[r]).wf("open_maintenance", { item_id: "MTMH_110", type: "Repair", issue_description: "x" }), r).rejects.toMatchObject({ code: "NOT_ALLOWED" });
      await expect(as(U[r]).wf("adjust_stock", { item_id: "MTMH_141", reason: "x", holdings: [] }), r).rejects.toMatchObject({ code: "NOT_ALLOWED" });
      await expect(as(U[r]).wf("set_custodian", { item_id: "MTMH_110", reason: "x" }), r).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    }
  });
});

describe("write permissions by role", () => {
  it("Staff cannot edit item master data; Admins can", async () => {
    for (const r of STAFF) {
      const res = await as(U[r]).q("update items set name = name || ' x' where id = 'MTMH_104' returning id");
      expect(res, r).toHaveLength(0); // RLS: no rows updatable
      await expect(as(U[r]).wf("create_item", { name: "x", type: "Accessory" }), r).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    }
    expect(await as(U.manager).q("update items set brand = 'Sony' where id = 'MTMH_104' returning id")).toHaveLength(1);
  });
  it("only Admins manage users, roles and settings", async () => {
    for (const r of STAFF) {
      expect(await as(U[r]).q("update users set role = 'Admin' where id = auth.uid() returning id"), r).toHaveLength(0);
      expect(await as(U[r]).q("update settings set value = '[]' where key = 'finance_roles' returning key"), r).toHaveLength(0);
      await expect(as(U[r]).wf("deactivate_user", { user_id: U.owner.id })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    }
    for (const r of ADMINS) expect(await as(U[r]).q("update settings set value = value where key = 'finance_roles' returning key"), r).toHaveLength(1);
  });
  it("loans, holdings, incidents and repairs cannot be written directly by anyone", async () => {
    for (const r of roles) {
      await expect(
        as(U[r]).q("insert into item_holdings(item_id, holder_location_id, status, quantity) select 'MTMH_141', id, 'Available', 1 from locations limit 1"),
      ).rejects.toThrow();
      expect(await as(U[r]).q("update loans set status = 'Returned' returning id")).toHaveLength(0);
      expect(await as(U[r]).q("delete from incidents returning id")).toHaveLength(0);
      expect(await as(U[r]).q("update maintenance_events set state = 'Closed' returning id")).toHaveLength(0);
    }
  });
  it("only Admins approve purchases, retire items and delete records; an Admin retires directly", async () => {
    const w = (await svc<{ id: string }>("select id from wishlist_items where status = 'To buy' limit 1"))[0].id;
    for (const r of STAFF) await expect(as(U[r]).wf("decide_wishlist", { wishlist_id: w, approve: true }), r).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    for (const r of STAFF) await expect(as(U[r]).wf("request_retirement", { item_id: "MTMH_104", kind: "Sold", reason: "x" }), r).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    expect((await svc("select status from wishlist_items where id = $1", [w]))[0].status).toBe("To buy");
    await expect(as(U.team).wf("delete_item_created_in_error", { item_id: "MTMH_104", reason: "x" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(as(U.manager).wf("delete_item_created_in_error", { item_id: "MTMH_104", reason: "x" })).rejects.toMatchObject({ code: "HAS_HISTORY" }); // imported -> retire instead
    await as(U.manager).wf("decide_wishlist", { wishlist_id: w, approve: true });
    expect((await svc("select status from wishlist_items where id = $1", [w]))[0].status).toBe("Approved");
  });
  it("global audit log is Admin-only; append-only for everyone", async () => {
    for (const r of ADMINS) expect(await count(U[r], "select * from audit_log"), r).toBeGreaterThan(100);
    for (const r of STAFF) expect(await count(U[r], "select * from audit_log"), r).toBe(0);
    await expect(as(U.owner).q("delete from audit_log")).rejects.toThrow();
    await expect(svc("truncate audit_log")).rejects.toThrow();
  });
  it("contact values are Admin-only (D-35); Staff only learn whether an email / phone is on file", async () => {
    const pid = (await svc<{ id: string }>("insert into people(name, person_type) values ('Email-only borrower', 'Freelancer') returning id"))[0].id;
    await svc("insert into people_contacts(person_id, email) values ($1, 'only.email@example.com')", [pid]);
    expect(await count(U.team, "select * from people_contacts")).toBe(0);
    expect(await count(U.manager, "select * from people_contacts where email = 'only.email@example.com'")).toBe(1);
    expect(await as(U.team).wf("borrower_contact_status", { person_id: pid })).toEqual({ has_email: true, has_phone: false });
  });
  it("a deactivated user loses all access immediately (NFR-006)", async () => {
    await as(U.owner).wf("deactivate_user", { user_id: U.team.id });
    expect(await count(U.team, "select id from items")).toBe(0);
    expect(await count(U.team, "select * from items_v")).toBe(0);
    await expect(as(U.team).wf("checkout", { item_id: "MTMH_105", condition_out: "Good" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
  it("anonymous requests see nothing", async () => {
    const { withUser } = await import("@/lib/db");
    const n = await withUser("00000000-0000-0000-0000-000000000000", async (c) => (await c.query("select count(*)::int n from items_v")).rows[0].n);
    expect(n).toBe(0);
  });
});
