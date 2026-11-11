/** A6: two users checking out the same Single item / the last Counted unit at the same moment. */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, newItem, personId, closePool, type Users } from "../helpers/db";

let U: Users;
let chiru: string;
beforeAll(async () => {
  U = await freshDb();
  chiru = await personId("Chiru");
});
afterAll(closePool);

describe("concurrency", () => {
  it("only one of 10 simultaneous check-outs of a Single item succeeds", async () => {
    const id = await newItem(U.manager, { name: "Race Stand", type: "Stand" });
    const attempts = Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? as(U.team) : as(U.manager)).wf("checkout", i % 2 ? { item_id: id, condition_out: "Good" } : { item_id: id, borrower_person_id: chiru, condition_out: "Good" }),
    );
    const res = await Promise.allSettled(attempts);
    const ok = res.filter((r) => r.status === "fulfilled");
    const codes = res.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason.code);
    expect(ok).toHaveLength(1);
    expect(new Set(codes)).toEqual(new Set(["ALREADY_OUT"]));
    const n = await svc("select count(*)::int n from loan_lines where item_id=$1 and active", [id]);
    expect(n[0].n).toBe(1);
  });

  it("the last Counted unit cannot be allocated twice", async () => {
    const id = await newItem(U.manager, { name: "Race Cards", type: "SD Card", quantity_mode: "Counted", stock: 3 });
    await as(U.manager).wf("checkout", { item_id: id, quantity: 2, borrower_person_id: chiru, condition_out: "Good" });
    const res = await Promise.allSettled([
      as(U.team).wf("checkout", { item_id: id, quantity: 1, condition_out: "Good" }),
      as(U.team2).wf("checkout", { item_id: id, quantity: 1, condition_out: "Good" }),
      as(U.manager).wf("checkout", { item_id: id, quantity: 1, borrower_person_id: chiru, condition_out: "Good" }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const q = await svc("select * from app.item_quantities($1)", [id]);
    expect(q[0]).toMatchObject({ available_qty: 0, out_qty: 3 });
  });

  it("concurrent item creation never duplicates ids", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => newItem(U.manager, { name: `Race Item ${i}`, type: "Accessory" })));
    expect(new Set(ids).size).toBe(8);
  });
});
