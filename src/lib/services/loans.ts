import "server-only";
import { withUser, withService, callWorkflow } from "../db";
import type { CurrentUser } from "../auth";
import { notify, notifySlack, managerEmails, managersAndOwner } from "./notifications";
import { fmtDateTime } from "../format";
import { AppError } from "../errors";

type CheckoutResult = { loan_id: string; due_at: string; warnings: string[]; duplicate?: boolean };
type CheckinResult = { loan_id: string; status: string; condition_worse: boolean; repair_ids: string[]; incident_ids: string[]; warnings: string[] };

async function loanSummary(loanId: string) {
  return withService(
    async (c) =>
      (
        await c.query(
          `select l.id, l.due_at, l.status, p.name as borrower, string_agg(ll.item_id || ' ' || i.name, ', ' order by ll.item_id) as items
       from loans l join people p on p.id = l.borrower_person_id join loan_lines ll on ll.loan_id = l.id join items i on i.id = ll.item_id
      where l.id = $1 group by l.id, p.name`,
          [loanId],
        )
      ).rows[0],
  );
}

const text = (p: Record<string, unknown>, k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : p[k] == null ? "" : String(p[k]).trim());
const need = (ok: unknown, code: string, message: string) => {
  if (!ok) throw new AppError(code, message);
};

/**
 * Borrower details are mandatory at check-out (2026-11-24): who (chosen, or a new borrower with name, email and phone),
 * their email and phone on file (asked for when missing), purpose / project, due date and condition.
 * Checked here for the form and offline sync alike, and again by the database.
 */
export function validateCheckout(p: Record<string, unknown>) {
  const borrower = text(p, "borrower_person_id");
  need(borrower, "BORROWER_REQUIRED", "Choose the borrower.");
  if (borrower === "__new") {
    need(text(p, "new_name"), "NAME_REQUIRED", "Enter the new borrower's full name.");
    need(text(p, "new_email"), "EMAIL_REQUIRED", "Enter the new borrower's email address.");
    need(text(p, "new_phone"), "PHONE_REQUIRED", "Enter the new borrower's phone number.");
  }
  need(text(p, "purpose"), "PURPOSE_REQUIRED", "Enter the purpose, project or shoot.");
  need(text(p, "due_at"), "DUE_REQUIRED", "Enter when the item is due back.");
  need(text(p, "condition_out"), "CONDITION_REQUIRED", "Choose the condition at check-out.");
  if (p.quantity !== undefined && p.quantity !== null) need(Number(p.quantity) >= 1, "BAD_QTY", "Quantity must be at least 1.");
}

/** "__new" -> registers the borrower (name, email, phone); otherwise fills in an email / phone that is missing on file. */
export async function prepareBorrower(u: CurrentUser, p: Record<string, unknown>): Promise<string> {
  const borrower = text(p, "borrower_person_id");
  if (borrower === "__new") {
    const r = await withUser(u.id, (c) =>
      callWorkflow<{ person_id: string }>(c, "register_borrower", { name: text(p, "new_name"), email: text(p, "new_email"), phone: text(p, "new_phone") }),
    );
    return r.person_id;
  }
  if (text(p, "contact_email") || text(p, "contact_phone"))
    await withUser(u.id, (c) => callWorkflow(c, "complete_borrower_contact", { person_id: borrower, email: text(p, "contact_email"), phone: text(p, "contact_phone") }));
  return borrower;
}

/** has_email / has_phone for each person (yes/no only; Staff never see the values) */
export async function borrowerContactStatus(u: CurrentUser, personIds: string[]) {
  if (!personIds.length) return {} as Record<string, { has_email: boolean; has_phone: boolean }>;
  return withUser(u.id, async (c) => {
    const r = await c.query("select id, app.borrower_contact_status(jsonb_build_object('person_id', id)) s from unnest($1::uuid[]) id", [personIds]);
    return Object.fromEntries(r.rows.map((x) => [x.id, x.s])) as Record<string, { has_email: boolean; has_phone: boolean }>;
  });
}

export async function checkout(u: CurrentUser, input: Record<string, unknown>) {
  validateCheckout(input);
  const payload: Record<string, unknown> = { ...input, borrower_person_id: await prepareBorrower(u, input) };
  for (const k of ["new_name", "new_email", "new_phone", "contact_email", "contact_phone"]) delete payload[k];
  const r = await withUser(u.id, (c) => callWorkflow<CheckoutResult>(c, "checkout", payload));
  if (!r.duplicate) {
    const s = await loanSummary(r.loan_id);
    void notifySlack("NTF-013", `Checked out: ${s?.items} to ${s?.borrower} by ${u.name}, due ${fmtDateTime(s?.due_at)}`, `NTF-013:out:${r.loan_id}`).catch(() => {});
  }
  return r;
}

/**
 * What the borrower reports at check-in is mandatory (2026-11-24): condition, return notes, an explicit yes/no on damage
 * (with a description when yes) and, when anything is lost, where it was last seen.
 */
export function validateCheckin(p: Record<string, unknown>) {
  need(text(p, "condition_in"), "CONDITION_REQUIRED", "Choose the condition at check-in.");
  need(text(p, "notes"), "NOTES_REQUIRED", 'Enter the return notes (what the borrower said; write "No issues" if there were none).');
  if (p.damage_answer !== undefined) need(["yes", "no"].includes(text(p, "damage_answer")), "DAMAGE_ANSWER_REQUIRED", "Answer whether there is any damage.");
  if (p.damage) need(text(p, "damage_description"), "DAMAGE_DESCRIPTION_REQUIRED", "Describe the damage.");
  if (p.missing_answer !== undefined) need(["yes", "no"].includes(text(p, "missing_answer")), "MISSING_ANSWER_REQUIRED", "Answer whether anything is missing.");
  if (text(p, "missing_answer") === "yes") need(text(p, "missing_description"), "MISSING_DESCRIPTION_REQUIRED", "Describe what is missing.");
  const lines = (p.lines as { lost?: number }[] | undefined) ?? [];
  if (lines.some((l) => (l.lost ?? 0) > 0)) need(text(p, "lost_place"), "LOST_PLACE_REQUIRED", "Say where the lost item was last seen.");
}

export async function checkin(u: CurrentUser, payload: Record<string, unknown>) {
  validateCheckin(payload);
  const r = await withUser(u.id, (c) => callWorkflow<CheckinResult>(c, "checkin", payload));
  const s = await loanSummary(r.loan_id);
  if (payload.damage || r.condition_worse || r.repair_ids.length) {
    // NTF-005: item checked in damaged -> Managers, immediate
    await notify({
      code: "NTF-005",
      dedupe: `NTF-005:${r.loan_id}:${Date.now()}`,
      to: await managerEmails(),
      loanId: r.loan_id,
      subject: `Checked in damaged: ${s?.items}`,
      text:
        `${s?.items} was checked in by ${u.name} from ${s?.borrower} in worse condition.\n${payload.damage_description ?? ""}\n` +
        (r.repair_ids.length ? "A repair record was opened." : "No repair record yet — open one from the loan page."),
    });
    void notifySlack("NTF-005", `Damaged check-in: ${s?.items} from ${s?.borrower}`).catch(() => {});
  }
  if (r.incident_ids.length) await lostNotice(r.incident_ids, u);
  void notifySlack("NTF-013", `Checked in: ${s?.items} from ${s?.borrower} by ${u.name}`, `NTF-013:in:${r.loan_id}:${Date.now()}`).catch(() => {});
  return r;
}

export async function lostNotice(incidentIds: string[], u: CurrentUser) {
  // NTF-006: item reported lost or missing -> Managers and Naveen, immediate
  const rows = await withService(
    async (c) =>
      (
        await c.query(`select i.id, i.item_id, it.name, i.type, i.quantity, i.description, it.status from incidents i join items it on it.id = i.item_id where i.id = any($1)`, [
          incidentIds,
        ])
      ).rows,
  );
  for (const x of rows) {
    await notify({
      code: "NTF-006",
      dedupe: `NTF-006:${x.id}`,
      to: await managersAndOwner(),
      itemId: x.item_id,
      subject: `${x.status === "Missing" ? "Missing" : "Lost"}: ${x.item_id} ${x.name}`,
      text: `${x.item_id} ${x.name} (${x.quantity} unit(s)) was reported ${x.type.toLowerCase()} by ${u.name}.\n${x.description}`,
    });
    void notifySlack("NTF-006", `Reported ${x.type.toLowerCase()}: ${x.item_id} ${x.name}`).catch(() => {});
  }
}

export const transfer = (u: CurrentUser, p: Record<string, unknown>) => withUser(u.id, (c) => callWorkflow<{ loan_id: string }>(c, "transfer_loan", p));
export const extend = (u: CurrentUser, p: Record<string, unknown>) => withUser(u.id, (c) => callWorkflow(c, "extend_loan", p));
export async function markLost(u: CurrentUser, p: Record<string, unknown>) {
  const r = await withUser(u.id, (c) => callWorkflow<{ incident_ids: string[] }>(c, "mark_loan_lost", p));
  await lostNotice(r.incident_ids, u);
  return r;
}

export async function getLoan(u: CurrentUser, id: string) {
  return withUser(u.id, async (c) => {
    const loan = (
      await c.query(
        `select l.*, p.name as borrower_name, p.person_type, k.name as kit_name, ob.name as out_by_name, ib.name as in_by_name
         from loans l join people p on p.id = l.borrower_person_id left join kits k on k.id = l.kit_id
         left join users ou on ou.id = l.checked_out_by left join people ob on ob.id = ou.person_id
         left join users iu on iu.id = l.checked_in_by left join people ib on ib.id = iu.person_id where l.id = $1`,
        [id],
      )
    ).rows[0];
    if (!loan) return null;
    const lines = (
      await c.query(
        `select ll.*, i.name, i.type, i.quantity_mode, i.condition, (ll.quantity - ll.qty_returned - ll.qty_lost - ll.qty_transferred) as outstanding,
              ki.required as kit_required
         from loan_lines ll join items i on i.id = ll.item_id left join kit_items ki on ki.kit_id = $2 and ki.item_id = ll.item_id
        where ll.loan_id = $1 order by ll.item_id`,
        [id, loan.kit_id],
      )
    ).rows;
    const photos = (await c.query(`select * from photos where loan_id = $1 order by taken_at`, [id])).rows;
    const events = (
      await c.query(
        `select e.*, p.name as person_name, bp.name as by_name from loan_events e left join people p on p.id = e.person_id
         left join users u on u.id = e.by_user left join people bp on bp.id = u.person_id where e.loan_id = $1 order by e.at`,
        [id],
      )
    ).rows;
    const extensions = (
      await c.query(
        `select x.*, p.name as by_name from loan_extensions x left join users u on u.id = x.by_user left join people p on p.id = u.person_id where loan_id = $1 order by at`,
        [id],
      )
    ).rows;
    const reminders =
      u.role === "Admin"
        ? (await c.query(`select event_code, status, recipients, intended_recipients, created_at from notifications_log where loan_id = $1 order by created_at`, [id])).rows
        : [];
    const chain = (
      await c.query(
        `with recursive back as (select id, transferred_from_loan_id, 0 as d from loans where id = $1
          union all select l.id, l.transferred_from_loan_id, b.d - 1 from loans l join back b on l.id = b.transferred_from_loan_id),
        fwd as (select id, transferred_to_loan_id, 0 as d from loans where id = $1
          union all select l.id, l.transferred_to_loan_id, f.d + 1 from loans l join fwd f on l.id = f.transferred_to_loan_id)
       select x.id, x.d, l.status, l.checked_out_at, l.checked_in_at, p.name as borrower from (select id, d from back union select id, d from fwd) x
         join loans l on l.id = x.id join people p on p.id = l.borrower_person_id order by x.d`,
        [id],
      )
    ).rows;
    const repairs = (await c.query(`select id, item_id, state, type from maintenance_events where linked_loan_id = $1`, [id])).rows;
    const incidents = (await c.query(`select id, item_id, type, status from incidents where linked_loan_id = $1`, [id])).rows;
    return { loan, lines, photos, events, extensions, reminders, chain, repairs, incidents };
  });
}

export async function listLoans(u: CurrentUser, f: { status?: string; legacy?: boolean; person?: string; project?: string; from?: string; to?: string }) {
  return withUser(u.id, async (c) => {
    const w: string[] = [];
    const p: unknown[] = [];
    if (f.status === "open") w.push("l.status in ('Open','Overdue')");
    else if (f.status) {
      p.push(f.status);
      w.push(`l.status = $${p.length}`);
    }
    if (f.legacy) w.push("l.legacy and l.status in ('Open','Overdue')");
    if (f.person) {
      p.push(f.person);
      w.push(`l.borrower_person_id = $${p.length}`);
    }
    if (f.project) {
      p.push(`%${f.project}%`);
      w.push(`l.purpose_or_project ilike $${p.length}`);
    }
    if (f.from) {
      p.push(f.from);
      w.push(`coalesce(l.checked_out_at, l.created_at) >= $${p.length}::date`);
    }
    if (f.to) {
      p.push(f.to);
      w.push(`coalesce(l.checked_out_at, l.created_at) < ($${p.length}::date + 1)`);
    }
    return (
      await c.query(
        `select l.*, p.name as borrower_name, string_agg(ll.item_id || ' ' || i.name || case when ll.quantity > 1 then ' ×' || ll.quantity else '' end, ', ' order by ll.item_id) as items,
              (select count(*) from photos ph where ph.loan_id = l.id and ph.upload_state in ('pending','failed'))::int as pending_evidence
         from loans l join people p on p.id = l.borrower_person_id join loan_lines ll on ll.loan_id = l.id join items i on i.id = ll.item_id
        ${w.length ? "where " + w.join(" and ") : ""}
        group by l.id, p.name order by (l.status = 'Overdue') desc, l.due_at nulls last, l.created_at desc limit 500`,
        p,
      )
    ).rows;
  });
}

export async function personProfile(u: CurrentUser, personId: string) {
  return withUser(u.id, async (c) => {
    const person = (
      await c.query(`select p.*, us.role, us.login_email, us.active as login_active from people p left join users us on us.person_id = p.id where p.id = $1`, [personId])
    ).rows[0];
    if (!person) return null;
    const contact = u.role === "Admin" ? ((await c.query("select * from people_contacts where person_id = $1", [personId])).rows[0] ?? null) : null;
    const loans = (
      await c.query(
        `select l.*, string_agg(ll.item_id || ' ' || i.name || case when ll.quantity > 1 then ' ×' || ll.quantity else '' end, ', ' order by ll.item_id) as items
         from loans l join loan_lines ll on ll.loan_id = l.id join items i on i.id = ll.item_id
        where l.borrower_person_id = $1 group by l.id order by coalesce(l.checked_out_at, l.created_at) desc`,
        [personId],
      )
    ).rows;
    const damaged = (
      await c.query(
        `select l.id as loan_id, ll.item_id, i.name, l.condition_out, l.condition_in, l.checked_in_at from loans l join loan_lines ll on ll.loan_id = l.id join items i on i.id = ll.item_id
        where l.borrower_person_id = $1 and l.condition_in is not null and l.condition_out is not null
          and app.condition_rank(l.condition_in) < app.condition_rank(l.condition_out)
       union
       select m.linked_loan_id, m.item_id, i.name, null, 'Repair opened', m.reported_at from maintenance_events m join loans l on l.id = m.linked_loan_id join items i on i.id = m.item_id
        where l.borrower_person_id = $1`,
        [personId],
      )
    ).rows;
    const holdings = (
      await c.query(
        `select id as item_id, name, 'Single' as mode, 1 as quantity, status from items_v where holder_person_id = $1
       union all select h.item_id, i.name, 'Counted', h.quantity, h.status from item_holdings h join items i on i.id = h.item_id where h.holder_person_id = $1 and h.quantity > 0
       order by 1`,
        [personId],
      )
    ).rows;
    const detached = (
      await c.query(`select d.*, i.name from detached_accessories d join items i on i.id = d.item_id where d.holder_person_id = $1 and d.returned_at is null`, [personId])
    ).rows;
    const responsible = (
      await c.query(`select i.*, it.name from incidents i join items it on it.id = i.item_id where i.responsible_person_id = $1 order by i.reported_at desc`, [personId])
    ).rows;
    return { person, contact, loans, damaged, holdings, detached, responsible };
  });
}
