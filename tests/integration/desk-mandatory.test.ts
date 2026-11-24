/**
 * Check-out / check-in (2026-11-24): every detail the borrower gives is mandatory — checked by the service layer
 * (form and offline sync share it) and again by the database, so neither path can skip it.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, newItem, closePool, type Users } from "../helpers/db";
import { checkout, checkin, validateCheckout, validateCheckin } from "@/lib/services/loans";
import type { CurrentUser } from "@/lib/auth";

let U: Users;
let staff: CurrentUser;
const due = () => new Date(Date.now() + 2 * 86400_000).toISOString();
const base = (item_id: string, extra: Record<string, unknown> = {}) => ({ item_id, purpose: "Product shoot", due_at: due(), condition_out: "Good", ...extra });
const freshPerson = async (name: string, email?: string, phone?: string) => {
  const id = (await svc<{ id: string }>("insert into people(name, person_type) values ($1, 'Freelancer') returning id", [name]))[0].id;
  if (email || phone) await svc("insert into people_contacts(person_id, email, phone) values ($1, $2, $3)", [id, email ?? null, phone ?? null]);
  return id;
};

beforeAll(async () => {
  U = await freshDb();
  staff = { ...U.team, role: "Staff", isDeveloper: false, financeVisible: false, sessionVersion: 1 } as CurrentUser;
});
afterAll(closePool);

describe("check-out: borrower details are mandatory", () => {
  it("the form fields are each required (service layer, same for offline sync)", () => {
    const ok = { borrower_person_id: "x", purpose: "Shoot", due_at: due(), condition_out: "Good" };
    expect(() => validateCheckout(ok)).not.toThrow();
    for (const [field, code] of [
      ["borrower_person_id", "BORROWER_REQUIRED"],
      ["purpose", "PURPOSE_REQUIRED"],
      ["due_at", "DUE_REQUIRED"],
      ["condition_out", "CONDITION_REQUIRED"],
    ])
      expect(() => validateCheckout({ ...ok, [field]: "  " }), field).toThrow(expect.objectContaining({ code }));
    const nb = { ...ok, borrower_person_id: "__new", new_name: "A", new_email: "a@b.co", new_phone: "+91 98765 43210" };
    expect(() => validateCheckout(nb)).not.toThrow();
    for (const [field, code] of [
      ["new_name", "NAME_REQUIRED"],
      ["new_email", "EMAIL_REQUIRED"],
      ["new_phone", "PHONE_REQUIRED"],
    ])
      expect(() => validateCheckout({ ...nb, [field]: "" }), field).toThrow(expect.objectContaining({ code }));
  });

  it("Staff register a new borrower at the desk with name, email and phone, and the loan is theirs", async () => {
    const item = await newItem(U.manager, { name: "Desk light 1", type: "Light" });
    const r = await checkout(staff, base(item, { borrower_person_id: "__new", new_name: "Ravi Kumar", new_email: "Ravi@Example.com", new_phone: "+91 98765 43210" }));
    const row = (
      await svc<{ name: string; email: string; phone: string }>(
        "select p.name, c.email, c.phone from loans l join people p on p.id = l.borrower_person_id join people_contacts c on c.person_id = p.id where l.id = $1",
        [r.loan_id],
      )
    )[0];
    expect(row).toEqual({ name: "Ravi Kumar", email: "ravi@example.com", phone: "+91 98765 43210" });
  });

  it("a new borrower with a bad email or phone, or a name already on file, is refused", async () => {
    const item = await newItem(U.manager, { name: "Desk light 2", type: "Light" });
    const nb = { borrower_person_id: "__new", new_name: "Meera", new_email: "meera@example.com", new_phone: "+91 98765 43210" };
    await expect(checkout(staff, base(item, { ...nb, new_phone: "12345" }))).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    await expect(checkout(staff, base(item, { ...nb, new_email: "not-an-email" }))).rejects.toMatchObject({ code: "EMAIL_REQUIRED" });
    await expect(checkout(staff, base(item, { ...nb, new_name: "Chiru" }))).rejects.toMatchObject({ code: "BORROWER_EXISTS" });
  });

  it("a borrower with no email / phone on file is refused until they are given; existing values are never overwritten", async () => {
    const item = await newItem(U.manager, { name: "Desk light 3", type: "Light" });
    const p = await freshPerson("Phone-less Pooja", "pooja@example.com");
    await expect(checkout(staff, base(item, { borrower_person_id: p }))).rejects.toMatchObject({ code: "BORROWER_CONTACT_REQUIRED" });
    await expect(checkout(staff, base(item, { borrower_person_id: p, contact_phone: "98" }))).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
    // an attempt to change the email on file through the desk is ignored; only the missing phone is filled in
    const r = await checkout(staff, base(item, { borrower_person_id: p, contact_email: "hijack@example.com", contact_phone: "98765 43210" }));
    expect(r.loan_id).toBeTruthy();
    expect((await svc("select email, phone from people_contacts where person_id = $1", [p]))[0]).toEqual({ email: "pooja@example.com", phone: "98765 43210" });
  });

  it("the database enforces it too (a direct call cannot skip a field)", async () => {
    const item = await newItem(U.manager, { name: "Desk light 4", type: "Light" });
    const chiru = (await svc<{ id: string }>("select id from people where name = 'Chiru'"))[0].id;
    await expect(as(U.team).wf("checkout", { item_id: item, borrower_person_id: chiru, condition_out: "Good", purpose: "" })).rejects.toMatchObject({ code: "PURPOSE_REQUIRED" });
    await expect(as(U.team).wf("checkout", { item_id: item, borrower_person_id: chiru, condition_out: "Good", due_at: null })).rejects.toMatchObject({ code: "DUE_REQUIRED" });
    await expect(as(U.team).wf("checkout", { item_id: item, borrower_person_id: chiru, condition_out: null })).rejects.toMatchObject({ code: "CONDITION_REQUIRED" });
    const nobody = await freshPerson("No-contact Nikhil");
    await expect(as(U.team).wf("checkout", { item_id: item, borrower_person_id: nobody, condition_out: "Good" })).rejects.toMatchObject({ code: "BORROWER_CONTACT_REQUIRED" });
  });
});

describe("check-in: what the borrower reports is mandatory", () => {
  it("condition, return notes, damage yes/no (+ description), missing yes/no (+ description), lost place", () => {
    const ok = { condition_in: "Good", notes: "No issues", damage_answer: "no", missing_answer: "no", lines: [{ lost: 0 }] };
    expect(() => validateCheckin(ok)).not.toThrow();
    const bad: [Record<string, unknown>, string][] = [
      [{ condition_in: "" }, "CONDITION_REQUIRED"],
      [{ notes: " " }, "NOTES_REQUIRED"],
      [{ damage_answer: "" }, "DAMAGE_ANSWER_REQUIRED"],
      [{ damage_answer: "yes", damage: true }, "DAMAGE_DESCRIPTION_REQUIRED"],
      [{ missing_answer: "" }, "MISSING_ANSWER_REQUIRED"],
      [{ missing_answer: "yes" }, "MISSING_DESCRIPTION_REQUIRED"],
      [{ lines: [{ lost: 1 }] }, "LOST_PLACE_REQUIRED"],
    ];
    for (const [patch, code] of bad) expect(() => validateCheckin({ ...ok, ...patch }), code).toThrow(expect.objectContaining({ code }));
  });

  it("a real check-in through the service: refused without the declarations, accepted with them", async () => {
    const item = await newItem(U.manager, { name: "Desk light 5", type: "Light" });
    const out = await checkout(staff, base(item, { borrower_person_id: U.team2.personId }));
    const line = (await svc<{ id: string }>("select id from loan_lines where loan_id = $1", [out.loan_id]))[0].id;
    const p = { loan_id: out.loan_id, lines: [{ line_id: line, returned: 1, lost: 0 }], condition_in: "Good", damage_answer: "no", missing_answer: "no" };
    await expect(checkin(staff, { ...p, notes: "" })).rejects.toMatchObject({ code: "NOTES_REQUIRED" });
    await checkin(staff, { ...p, notes: "Returned clean, all parts present" });
    expect((await svc("select status, notes from loans where id = $1", [out.loan_id]))[0]).toMatchObject({ status: "Returned", notes: expect.stringContaining("Returned clean") });
  });

  it("the database refuses a check-in without a condition", async () => {
    const item = await newItem(U.manager, { name: "Desk light 6", type: "Light" });
    const out = await checkout(staff, base(item, { borrower_person_id: U.team2.personId }));
    await expect(as(U.team).wf("checkin", { loan_id: out.loan_id, condition_in: null })).rejects.toMatchObject({ code: "CONDITION_REQUIRED" });
  });
});
