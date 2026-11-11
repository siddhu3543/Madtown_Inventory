/**
 * A5: "Test access through both the UI and direct API/database requests for every role."
 * Direct SQL as each role (the same path Supabase's Data API would use with a user's JWT), against section 9.
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
const roles = ["owner", "manager", "team", "readonly", "dev"] as const;

describe("financial data (section 9 row 2, D-04, NFR-004)", () => {
  const FIN = [
    "select * from item_financials",
    "select * from maintenance_costs",
    "select * from order_financials",
    "select * from wishlist_options",
    "select * from wishlist_financials where estimated_cost is not null or legacy_raw is not null",
  ];
  const expectVisible = { owner: true, manager: true, team: false, readonly: true, dev: false };
  for (const r of roles)
    it(`${r}: financial tables ${expectVisible[r] ? "visible" : "hidden"}`, async () => {
      for (const q of FIN) {
        const n = await count(U[r], q);
        if (expectVisible[r]) expect(n, q).toBeGreaterThan(0);
        else expect(n, q).toBe(0);
      }
    });
  it("no role can read raw notes directly; masked via items_v unless finance", async () => {
    for (const r of roles) await expect(as(U[r]).q("select notes from items limit 1")).rejects.toThrow(/permission denied/);
    expect((await as(U.team).q<{ notes: string }>("select notes from items_v where id = 'MTMH_203'"))[0].notes).toMatch(/Rs ▒▒▒/);
    expect((await as(U.readonly).q<{ notes: string }>("select notes from items_v where id = 'MTMH_203'"))[0].notes).toMatch(/21,999/);
  });
  it("guessed ids do not leak prices through joins or functions", async () => {
    const id = (await svc<{ id: string }>("select id from orders limit 1"))[0].id;
    expect(await as(U.team).q("select * from order_financials where order_id = $1", [id])).toHaveLength(0);
    expect(await as(U.team).q("select * from orders where id = $1", [id])).toHaveLength(0); // Team cannot see orders at all
    expect(await as(U.team).q("select * from app.item_audit('MTMH_203')")).toHaveLength(0);
  });
  it("legacy raw sheet values (may contain prices) are finance or developer only", async () => {
    expect(await count(U.team, "select * from item_import_raw")).toBe(0);
    expect(await count(U.dev, "select * from item_import_raw")).toBe(103);
  });
});

describe("write permissions by role (section 9)", () => {
  it("Team member and Read-only cannot edit item master data; Manager can", async () => {
    for (const r of ["team", "readonly", "dev"] as const) {
      const res = await as(U[r]).q("update items set name = name || ' x' where id = 'MTMH_104' returning id");
      expect(res, r).toHaveLength(0); // RLS: no rows updatable
    }
    expect(await as(U.manager).q("update items set brand = 'Sony' where id = 'MTMH_104' returning id")).toHaveLength(1);
  });
  it("only the Owner manages users, roles and settings", async () => {
    for (const r of ["manager", "team", "readonly"] as const) {
      expect(await as(U[r]).q("update users set role = 'Owner' where id = auth.uid() returning id"), r).toHaveLength(0);
      expect(await as(U[r]).q("update settings set value = '[]' where key = 'finance_roles' returning key"), r).toHaveLength(0);
      await expect(as(U[r]).wf("deactivate_user", { user_id: U.owner.id })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    }
    expect(await as(U.owner).q("update settings set value = value where key = 'finance_roles' returning key")).toHaveLength(1);
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
  it("only the Owner approves purchases, retirements and write-offs; deletion is Owner-only", async () => {
    const w = (await svc<{ id: string }>("select id from wishlist_items where status = 'To buy' limit 1"))[0].id;
    for (const r of ["manager", "team", "readonly"] as const) {
      await expect(as(U[r]).wf("decide_wishlist", { wishlist_id: w, approve: true })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
      await expect(as(U[r]).q("update wishlist_items set status = 'Approved' where id = $1", [w]))
        .resolves.toBeDefined()
        .catch(() => {});
    }
    expect((await svc("select status from wishlist_items where id = $1", [w]))[0].status).toBe("To buy");
    await expect(as(U.manager).q("update wishlist_items set approved_by = auth.uid() where id = $1", [w])).rejects.toMatchObject({ code: "WISHLIST_DECISION" });
    await expect(as(U.manager).wf("delete_item_created_in_error", { item_id: "MTMH_104", reason: "x" })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(as(U.owner).wf("delete_item_created_in_error", { item_id: "MTMH_104", reason: "x" })).rejects.toMatchObject({ code: "HAS_HISTORY" }); // imported -> retire instead
    const r = await as(U.manager).wf<{ status: string }>("request_retirement", { item_id: "MTMH_104", kind: "Sold", reason: "Sold to a client" });
    expect(r.status).toBe("Pending");
    expect((await svc("select status from items where id='MTMH_104'"))[0].status).not.toBe("Retired");
  });
  it("Team members propose to-buy lines but cannot set approval fields (section 9 'to confirm')", async () => {
    const r = await as(U.team).q<{ id: string; status: string; proposed_by: string }>(
      "insert into wishlist_items(item_description, replaces_or_adds, priority, status, approved_by) values ('Team idea','Adds','Low','To buy', auth.uid()) returning id, status, proposed_by",
    );
    expect(r[0].proposed_by).toBe(U.team.id);
    expect((await svc("select approved_by from wishlist_items where id = $1", [r[0].id]))[0].approved_by).toBeNull();
    await expect(as(U.team).q("insert into wishlist_items(item_description, replaces_or_adds, priority, status) values ('x','Adds','Low','Approved')")).rejects.toMatchObject({
      code: "WISHLIST_STATUS",
    });
  });
  it("global audit log Owner only; append-only for everyone", async () => {
    expect(await count(U.owner, "select * from audit_log")).toBeGreaterThan(100);
    for (const r of ["manager", "team", "readonly", "dev"] as const) expect(await count(U[r], "select * from audit_log"), r).toBe(0);
    await expect(as(U.owner).q("delete from audit_log")).rejects.toThrow();
    await expect(svc("truncate audit_log")).rejects.toThrow();
  });
  it("contacts of borrowers without login are Manager-only (D-35)", async () => {
    await svc("insert into people_contacts(person_id, email) select id, 'chiru@example.com' from people where name = 'Chiru'");
    expect(await count(U.team, "select * from people_contacts")).toBe(0);
    expect(await count(U.manager, "select * from people_contacts")).toBe(1);
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
