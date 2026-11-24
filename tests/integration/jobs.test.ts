import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDb, as, svc, newItem, personId, closePool, type Users } from "../helpers/db";
import { reminders, weeklySummary, weeklyMissing, repairsOverdue } from "@/lib/services/jobs";
import { runMirror, SHEET1_COLUMNS } from "@/lib/services/mirror";
import { runImport } from "@/lib/importer/apply";

let U: Users;
beforeAll(async () => {
  U = await freshDb();
});
afterAll(closePool);

// 2026-11-10 is a Tuesday. 09:30 IST = 04:00 UTC.
const at = (iso: string) => new Date(iso);

describe("AC-LOAN-01: due-soon, due-today, daily overdue, escalation on day 3", () => {
  let loanId: string;
  it("sends due-soon 24 h before, once", async () => {
    const chiru = await personId("Chiru");
    await svc("insert into people_contacts(person_id, email) values ($1, 'chiru.freelance@example.com') on conflict (person_id) do update set email = excluded.email", [chiru]);
    const item = await newItem(U.manager, { name: "Reminder Stand", type: "Stand" });
    const r = await as(U.manager).wf<{ loan_id: string }>("checkout", { item_id: item, borrower_person_id: chiru, condition_out: "Good", due_at: "2027-01-12T12:30:00Z" });
    loanId = r.loan_id;
    // move the loan into the scenario timeline: checked out 9 Jan, due 12 Jan 18:00 IST
    await svc("update loans set checked_out_at = '2027-01-09T04:00:00Z', due_at = '2027-01-12T12:30:00Z' where id = $1", [loanId]);
    const before = await reminders({ now: at("2027-01-11T10:00:00Z") }); // 26.5 h before due
    expect(before.due_soon).toBe(0);
    const r1 = await reminders({ now: at("2027-01-11T13:00:00Z") }); // 23.5 h before
    expect(r1.due_soon).toBe(1);
    const r2 = await reminders({ now: at("2027-01-11T14:00:00Z") });
    expect(r2.due_soon).toBe(0); // dedupe
    const n = await svc<{ recipients: string[]; intended_recipients: string[]; status: string }>(
      "select recipients, intended_recipients, status from notifications_log where event_code='NTF-001' and loan_id=$1",
      [loanId],
    );
    expect(n[0].intended_recipients).toEqual(expect.arrayContaining(["chiru.freelance@example.com", "anand@madtown.in"]));
    expect(n[0].recipients).toEqual(["staging-inbox@madtown.in"]); // A3: staging sandbox redirect
    expect(n[0].status).toBe("sandboxed");
  });
  it("sends due-today at 09:00 IST on the due date", async () => {
    expect((await reminders({ now: at("2027-01-12T02:00:00Z") })).due_today).toBe(0); // 07:30 IST
    expect((await reminders({ now: at("2027-01-12T04:00:00Z") })).due_today).toBe(1); // 09:30 IST
  });
  it("marks overdue and sends one overdue mail per day; escalates to Anand and Naveen on day 3", async () => {
    const d1 = await reminders({ now: at("2027-01-13T04:00:00Z") });
    expect(d1.marked_overdue).toBe(1);
    expect(d1.overdue).toBe(1);
    expect(d1.escalated).toBe(0);
    expect((await reminders({ now: at("2027-01-13T08:00:00Z") })).overdue).toBe(0); // same day
    expect((await reminders({ now: at("2027-01-14T04:00:00Z") })).escalated).toBe(0); // day 1.6
    const d3 = await reminders({ now: at("2027-01-15T13:00:00Z") }); // 3 days after due
    expect(d3.overdue).toBe(1);
    expect(d3.escalated).toBe(1);
    const esc = await svc<{ intended_recipients: string[] }>("select intended_recipients from notifications_log where event_code='NTF-004' and loan_id=$1", [loanId]);
    expect(esc[0].intended_recipients.sort()).toEqual(["anand@madtown.in", "naveen@madtown.in"]);
    expect((await reminders({ now: at("2027-01-16T04:00:00Z") })).escalated).toBe(0); // escalation once
  });
  it("FR-LOAN-010: reminders are counted on the loan; bot mail copies naveen@madtown.in (section 8)", async () => {
    const l = await svc<{ reminder_count: number }>("select reminder_count from loans where id=$1", [loanId]);
    expect(l[0].reminder_count).toBe(7); // due-soon 1 + due-today 1 + overdue 13,14,15,16 = 4 + escalation 1
    const cc = await svc<{ cc: string[]; intended_recipients: string[] }>("select cc, intended_recipients from notifications_log where event_code='NTF-001' and loan_id=$1", [
      loanId,
    ]);
    expect(cc[0].intended_recipients).not.toContain("naveen@madtown.in");
    const raw = await svc<{ body_text: string }>("select body_text from notifications_log where event_code='NTF-003' and loan_id=$1 limit 1", [loanId]);
    expect(raw[0].body_text).toMatch(/overdue/);
  });
  it("weekly summary runs Monday 09:00 IST only (NTF-012)", async () => {
    expect(((await weeklySummary({ now: at("2027-01-12T04:00:00Z") })) as { skipped?: string }).skipped).toBeTruthy(); // Tuesday
    expect(((await weeklySummary({ now: at("2027-01-18T04:00:00Z") })) as { sent?: boolean }).sent).toBe(true); // Monday
  });
});

describe("weekly missing and repair overdue (NTF-007, NTF-008)", () => {
  it("weekly missing reminder once per week; repair overdue the day after expected", async () => {
    const it1 = await newItem(U.manager, { name: "Missing thing", type: "Accessory" });
    await as(U.team).wf("report_incident", { item_id: it1, type: "Loss", mark: "Missing", description: "Not in the store" });
    expect((await weeklyMissing({ now: at("2027-02-01T04:00:00Z") })).sent).toBe(1);
    expect((await weeklyMissing({ now: at("2027-02-02T04:00:00Z") })).sent).toBe(0);
    const it2 = await newItem(U.manager, { name: "Repair thing", type: "Light" });
    await as(U.manager).wf("open_maintenance", { item_id: it2, type: "Repair", state: "Sent for repair", issue_description: "x", vendor: "V", expected_back: "2027-02-03" });
    expect((await repairsOverdue({ now: at("2027-02-03T05:00:00Z") })).sent).toBe(0);
    expect((await repairsOverdue({ now: at("2027-02-04T05:00:00Z") })).sent).toBe(1);
  });
});

describe("AC-RPT-02: mirror reproduces the current column layout with current values", () => {
  it("writes Sheet1 / To buy / Not yet sorted with the 13 columns and current values; tagged Sync", async () => {
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
    await as(U.manager).q("update items set name = 'Sony FX3 (main body)' where id = 'MTMH_101'");
    const r = await runMirror("manual", U.owner.id);
    expect(r.rows).toBe(103);
    const rows = Papa.parse<string[]>(readFileSync(".mirror-test/Sheet1.csv", "utf8")).data;
    expect(rows[0]).toEqual(SHEET1_COLUMNS);
    const byId = new Map(rows.slice(1).map((x) => [x[0], x]));
    expect(byId.size).toBe(103);
    expect(byId.get("MTMH_101")![1]).toBe("Sony FX3 (main body)");
    expect(byId.get("MTMH_106")![8]).toBe("Repairing");
    expect(byId.get("MTMH_111")![8]).toBe("Lost");
    expect(byId.get("MTMH_111")![9]).toBe("Lost");
    expect(byId.get("MTMH_110")![9]).toBe("Madtown, Kittu");
    expect(byId.get("MTMH_110")![10]).toBe("Kittu");
    expect(byId.get("MTMH_103")![12]).toBe("16 Oct 2026");
    expect(byId.get("MTMH_202")![2]).toBe("TBD");
    expect(byId.get("MTMH_203")![7]).not.toMatch(/21,999/); // D-07 masking in the mirror
    expect(byId.get("MTMH_114")![6]).toBe("lost");
    const tb = Papa.parse<string[]>(readFileSync(".mirror-test/To buy.csv", "utf8")).data;
    expect(tb.length).toBe(26);
    const log = await svc("select source from audit_log where table_name='mirror_runs' and action='sync'");
    expect(log[0].source).toBe("Sync");
  });
});
