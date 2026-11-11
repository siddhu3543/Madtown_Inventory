import "server-only";
import { withService } from "../db";
import { notify, emailsForRoles, escalationEmails, personEmail, userEmail } from "./notifications";
import { fmtDate, fmtDateTime, istParts } from "../format";
import { runMirror } from "./mirror";
import { weeklyExport } from "./backup";

/** Every job takes `now` so behaviour at 09:00 IST, day 3 overdue, Mondays etc. is testable (AC-LOAN-01). */
type Ctx = { now: Date };
const setting = async (k: string) => withService(async (c) => (await c.query("select app.setting($1) v", [k])).rows[0]?.v);

async function logJob<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const id = await withService(async (c) => (await c.query("insert into job_runs(job) values ($1) returning id", [job])).rows[0].id);
  try {
    const r = await fn();
    await withService((c) => c.query("update job_runs set finished_at = now(), status = 'succeeded', detail = $2 where id = $1", [id, JSON.stringify(r ?? {})]));
    return r;
  } catch (e) {
    await withService((c) =>
      c.query("update job_runs set finished_at = now(), status = 'failed', detail = $2 where id = $1", [id, JSON.stringify({ error: (e as Error).message })]),
    );
    console.error(JSON.stringify({ level: "error", msg: "job failed", job, err: (e as Error).message })); // A2 monitoring: alert on failed jobs
    throw e;
  }
}

/** NTF-001..004, FR-LOAN-003/004/010 */
export async function reminders({ now }: Ctx) {
  return logJob("reminders", async () => {
    const hour = Number((await setting("reminder_hour_ist")) ?? 9);
    const escDays = Number((await setting("escalation_days")) ?? 3);
    const ist = istParts(now);
    const marked = await withService(
      async (c) => (await c.query("update loans set status = 'Overdue' where status = 'Open' and due_at is not null and due_at < $1 returning id", [now])).rowCount,
    );
    const loans = await withService(
      async (c) =>
        (
          await c.query(`
      select l.id, l.due_at, l.status, l.borrower_person_id, l.checked_out_by, p.name as borrower,
             string_agg(ll.item_id || ' ' || i.name || case when ll.quantity > 1 then ' ×' || ll.quantity else '' end, ', ' order by ll.item_id) as items
        from loans l join people p on p.id = l.borrower_person_id join loan_lines ll on ll.loan_id = l.id and ll.active join items i on i.id = ll.item_id
       where l.status in ('Open','Overdue') and l.due_at is not null and not l.legacy
       group by l.id, p.name`)
        ).rows,
    );
    const counts = { marked_overdue: marked, due_soon: 0, due_today: 0, overdue: 0, escalated: 0 };
    for (const l of loans) {
      const due = new Date(l.due_at);
      const recips = await withService(async (c) => [await personEmail(c, l.borrower_person_id), await userEmail(c, l.checked_out_by)].filter(Boolean) as string[]);
      const managers = recips.length ? recips : await withService((c) => emailsForRoles(c, ["Manager"]));
      const send = async (code: string, dedupe: string, subject: string, text: string) => {
        const s = await notify({ code, dedupe, to: managers, loanId: l.id, subject, text });
        if (s !== "skipped") await withService((c) => c.query("update loans set reminder_count = reminder_count + 1 where id = $1", [l.id]));
        return s !== "skipped";
      };
      const hrsToDue = (due.getTime() - now.getTime()) / 3600_000;
      const dueIst = istParts(due);
      if (
        hrsToDue > 0 &&
        hrsToDue <= 24 &&
        (await send("NTF-001", `NTF-001:${l.id}`, `Due soon: ${l.items}`, `Reminder: ${l.items} borrowed by ${l.borrower} is due back ${fmtDateTime(due)}.`))
      )
        counts.due_soon++;
      if (
        dueIst.dateKey === ist.dateKey &&
        hrsToDue > 0 &&
        ist.hh >= hour &&
        (await send("NTF-002", `NTF-002:${l.id}:${ist.dateKey}`, `Due today: ${l.items}`, `${l.items} borrowed by ${l.borrower} is due back today, ${fmtDateTime(due)}.`))
      )
        counts.due_today++;
      if (due < now && ist.hh >= hour) {
        const days = Math.floor((now.getTime() - due.getTime()) / 86400_000);
        if (
          await send(
            "NTF-003",
            `NTF-003:${l.id}:${ist.dateKey}`,
            `Overdue: ${l.items}`,
            `${l.items} borrowed by ${l.borrower} was due ${fmtDateTime(due)} and is ${days} day(s) overdue. Please return it or ask for an extension.`,
          )
        )
          counts.overdue++;
        if (days >= escDays) {
          const esc = await escalationEmails();
          const s = await notify({
            code: "NTF-004",
            dedupe: `NTF-004:${l.id}`,
            to: esc,
            loanId: l.id,
            subject: `Escalation: ${l.items} ${days} days overdue`,
            text: `${l.items} borrowed by ${l.borrower} has been overdue since ${fmtDateTime(due)} (${days} days).`,
          });
          if (s !== "skipped") {
            counts.escalated++;
            await withService((c) => c.query("update loans set reminder_count = reminder_count + 1 where id = $1", [l.id]));
          }
        }
      }
    }
    return counts;
  });
}

const isoWeek = (d: Date) => {
  const p = istParts(d);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)}`;
};

/** NTF-007 / FR-LST-005: weekly reminder to Managers for unresolved Missing items */
export async function weeklyMissing({ now }: Ctx) {
  return logJob("weekly-missing", async () => {
    const items = await withService(async (c) => (await c.query(`select v.id, v.name, v.missing_qty from items_v v where v.flag_missing`)).rows);
    if (!items.length) return { sent: 0 };
    const s = await notify({
      code: "NTF-007",
      dedupe: `NTF-007:${isoWeek(now)}`,
      to: await withService((c) => emailsForRoles(c, ["Manager"])),
      subject: `Still missing: ${items.length} item(s)`,
      text: items.map((i) => `- ${i.id} ${i.name}${i.missing_qty > 1 ? ` (${i.missing_qty} units)` : ""}`).join("\n"),
    });
    return { sent: s === "skipped" ? 0 : 1, items: items.length };
  });
}

/** NTF-008: repair expected-back date passed -> Anand (Managers), day after expected */
export async function repairsOverdue({ now }: Ctx) {
  return logJob("repairs-overdue", async () => {
    const today = istParts(now).dateKey;
    const rows = await withService(
      async (c) =>
        (
          await c.query(
            `select m.id, m.item_id, i.name, m.expected_back, m.vendor from maintenance_events m join items i on i.id = m.item_id
       where m.state not in ('Returned','Closed') and m.expected_back is not null and m.expected_back < $1::date`,
            [today],
          )
        ).rows,
    );
    let sent = 0;
    for (const r of rows)
      if (
        (await notify({
          code: "NTF-008",
          dedupe: `NTF-008:${r.id}`,
          to: await withService((c) => emailsForRoles(c, ["Manager"])),
          itemId: r.item_id,
          subject: `Repair overdue: ${r.item_id} ${r.name}`,
          text: `${r.item_id} ${r.name} was expected back from ${r.vendor ?? "the vendor"} on ${fmtDate(r.expected_back)}.`,
        })) !== "skipped"
      )
        sent++;
    return { sent };
  });
}

/** NTF-009 / FR-CON-006: service or upkeep due in 7 days -> Anand (Managers) */
export async function upkeepDue({ now }: Ctx) {
  return logJob("upkeep-due", async () => {
    const days = Number((await setting("upkeep_days_before")) ?? 7);
    const rows = await withService(
      async (c) =>
        (
          await c.query(
            `select s.id, s.next_due, coalesce(s.item_id, 'all ' || s.item_type) as target, i.name from maintenance_schedules s
       left join items i on i.id = s.item_id where s.active and s.next_due <= $1::date + $2::int`,
            [istParts(now).dateKey, days],
          )
        ).rows,
    );
    let sent = 0;
    for (const r of rows)
      if (
        (await notify({
          code: "NTF-009",
          dedupe: `NTF-009:${r.id}:${String(r.next_due).slice(0, 10)}`,
          to: await withService((c) => emailsForRoles(c, ["Manager"])),
          subject: `Service due: ${r.target}${r.name ? ` ${r.name}` : ""}`,
          text: `Service or upkeep for ${r.target} is due on ${fmtDate(r.next_due)}.`,
        })) !== "skipped"
      )
        sent++;
    return { sent };
  });
}

/** NTF-011: order overdue for delivery -> proposer and Anand */
export async function ordersOverdue({ now }: Ctx) {
  return logJob("orders-overdue", async () => {
    const rows = await withService(
      async (c) =>
        (
          await c.query(
            `select o.id, o.vendor, o.order_ref, o.expected_delivery,
        array_remove(array_agg(distinct u.login_email), null) as proposers from orders o left join order_lines ol on ol.order_id = o.id
        left join wishlist_items w on w.id = ol.wishlist_id left join users u on u.id = w.proposed_by
       where o.status in ('Placed','Partially delivered') and o.expected_delivery is not null and o.expected_delivery < $1::date group by o.id`,
            [istParts(now).dateKey],
          )
        ).rows,
    );
    let sent = 0;
    for (const r of rows)
      if (
        (await notify({
          code: "NTF-011",
          dedupe: `NTF-011:late:${r.id}`,
          to: [...r.proposers, ...(await withService((c) => emailsForRoles(c, ["Manager"])))],
          subject: `Order overdue: ${r.vendor} ${r.order_ref}`,
          text: `Order ${r.order_ref} from ${r.vendor} was expected on ${fmtDate(r.expected_delivery)} and is not delivered.`,
        })) !== "skipped"
      )
        sent++;
    return { sent };
  });
}

/** NTF-012 / FR-RPT-008: weekly summary to Naveen, Monday 09:00 IST (to confirm) */
export async function weeklySummary({ now }: Ctx, force = false) {
  return logJob("weekly-summary", async () => {
    const cfg = ((await setting("weekly_summary")) ?? { dow: 1, hour: 9 }) as { dow: number; hour: number };
    const ist = istParts(now);
    if (!force && (ist.dow !== cfg.dow || ist.hh < cfg.hour)) return { skipped: "not the scheduled time" };
    const d = await withService(async (c) => ({
      n: (
        await c.query(`select count(*) filter (where flag_out_now)::int out_now, count(*) filter (where flag_overdue)::int overdue, count(*) filter (where flag_in_repair)::int in_repair,
                                count(*) filter (where flag_lost)::int lost, count(*) filter (where flag_missing)::int missing, count(*) filter (where flag_bad_condition and is_active)::int bad_condition from items_v`)
      ).rows[0],
      tobuy: (await c.query("select count(*)::int n from wishlist_items where status = 'To buy'")).rows[0].n,
      overdue: (
        await c.query(`select l.due_at, p.name, string_agg(ll.item_id, ', ') items from loans l join people p on p.id = l.borrower_person_id
                                 join loan_lines ll on ll.loan_id = l.id and ll.active where l.status = 'Overdue' group by l.id, p.name order by l.due_at`)
      ).rows,
    }));
    const text = [
      `Weekly inventory summary, ${fmtDate(now)}`,
      "",
      `Out now: ${d.n.out_now}`,
      `Overdue: ${d.n.overdue}`,
      `In repair: ${d.n.in_repair}`,
      `Lost: ${d.n.lost}`,
      `Missing: ${d.n.missing}`,
      `Bad condition: ${d.n.bad_condition}`,
      `To-buy awaiting approval: ${d.tobuy}`,
      "",
      "Overdue list:",
      ...(d.overdue.length ? d.overdue.map((o) => `- ${o.items} — ${o.name}, due ${fmtDateTime(o.due_at)}`) : ["(none)"]),
    ].join("\n");
    const s = await notify({
      code: "NTF-012",
      dedupe: `NTF-012:${ist.dateKey}`,
      to: await withService((c) => emailsForRoles(c, ["Owner"])),
      subject: `Inventory weekly summary — ${fmtDate(now)}`,
      text,
      noCc: true,
    });
    return { sent: s !== "skipped" };
  });
}

/** FR-RPT-009 nightly mirror at mirror_hour_ist (A4); NFR-009 weekly export (Sunday) */
export async function nightly({ now }: Ctx) {
  const ist = istParts(now);
  const hour = Number((await setting("mirror_hour_ist")) ?? 2);
  const out: Record<string, unknown> = {};
  if (ist.hh === hour) out.mirror = await logJob("mirror", () => runMirror("nightly", null));
  if (ist.hh === hour && ist.dow === 0) out.export = await logJob("weekly-export", () => weeklyExport(now));
  return out;
}

export const JOBS = {
  reminders,
  "weekly-missing": weeklyMissing,
  "repairs-overdue": repairsOverdue,
  "upkeep-due": upkeepDue,
  "orders-overdue": ordersOverdue,
  "weekly-summary": (c: Ctx) => weeklySummary(c),
  nightly,
  mirror: () => logJob("mirror", () => runMirror("manual", null)),
  "weekly-export": ({ now }: Ctx) => logJob("weekly-export", () => weeklyExport(now)),
} as const;

/** Hourly entry point (one Vercel cron). Each job gates itself on IST time and dedupe keys. */
export async function runAll(ctx: Ctx) {
  const ist = istParts(ctx.now);
  const r: Record<string, unknown> = { reminders: await reminders(ctx) };
  if (ist.hh === 9) {
    r.repairs = await repairsOverdue(ctx);
    r.upkeep = await upkeepDue(ctx);
    r.orders = await ordersOverdue(ctx);
    if (ist.dow === 1) r.missing = await weeklyMissing(ctx);
  }
  r.summary = await weeklySummary(ctx);
  r.nightly = await nightly(ctx);
  return r;
}
