import "server-only";
import { withService, type Db } from "../db";
import { sendMail, sendSlack } from "../adapters/email";
import { env } from "../env";

export type Notice = { code: string; dedupe?: string | null; to: string[]; subject: string; text: string; loanId?: string | null; itemId?: string | null; noCc?: boolean };

/** Idempotent delivery (ADR-10): a dedupe key is sent at most once; every attempt is logged (section 8). */
export async function notify(n: Notice): Promise<"sent" | "sandboxed" | "failed" | "skipped"> {
  const to = [...new Set(n.to.filter(Boolean).map((x) => x.toLowerCase()))];
  const cc = n.noCc ? [] : (await botCc()).filter((x) => !to.includes(x));
  const id = await withService(async (c) => {
    const r = await c.query(
      `insert into notifications_log(event_code, dedupe_key, channel, recipients, cc, intended_recipients, subject, body_text, loan_id, item_id, status)
       values ($1,$2,'email',$3,$4,$3,$5,$6,$7,$8,'queued') on conflict (dedupe_key) do nothing returning id`,
      [n.code, n.dedupe ?? null, to, cc, n.subject, n.text, n.loanId ?? null, n.itemId ?? null],
    );
    return r.rows[0]?.id as string | undefined;
  });
  if (!id) return "skipped";
  const res = await sendMail({ to, cc, subject: n.subject, text: n.text + footer() });
  await withService((c) =>
    c.query(
      `update notifications_log set status = $2, provider_message_id = $3, error = $4, attempts = attempts + 1, sent_at = case when $2 <> 'failed' then now() end,
            recipients = $5, cc = $6 where id = $1`,
      [id, res.status, res.providerId ?? null, res.error ?? null, res.deliveredTo, res.deliveredCc],
    ),
  );
  if (res.status === "failed") console.error(JSON.stringify({ level: "error", msg: "notification failed", code: n.code, err: res.error }));
  return res.status;
}

/** Phase 2 Slack mirror of an alert (only when enabled in Settings). */
export async function notifySlack(code: string, text: string, dedupe?: string) {
  const enabled = await withService(async (c) => (await c.query("select coalesce((app.setting('slack_enabled') #>> '{}')::boolean, false) as e")).rows[0].e);
  if (!enabled) return "skipped";
  const id = await withService(
    async (c) =>
      (
        await c.query(
          `insert into notifications_log(event_code, dedupe_key, channel, subject, body_text, status) values ($1,$2,'slack',$3,$3,'queued') on conflict (dedupe_key) do nothing returning id`,
          [code, dedupe ?? null, text],
        )
      ).rows[0]?.id,
  );
  if (!id) return "skipped";
  const r = await sendSlack(text);
  await withService((c) => c.query("update notifications_log set status=$2, error=$3, attempts=attempts+1, sent_at=now() where id=$1", [id, r.status, r.error ?? null]));
  return r.status;
}

function footer() {
  return `\n\n— Madtown Inventory (${env.appBaseUrl}). This is an automated message from inventory@madtown.in.`;
}

async function botCc(): Promise<string[]> {
  return withService(async (c) => (await c.query("select coalesce(app.setting('bot_cc'), '[]'::jsonb) v")).rows[0].v as string[]);
}

export async function emailsForRoles(c: Db, roles: string[]): Promise<string[]> {
  return (await c.query("select login_email from users where active and role = any($1)", [roles])).rows.map((r) => r.login_email);
}
export async function managerEmails() {
  return withService((c) => emailsForRoles(c, ["Manager"]));
}
export async function managersAndOwner() {
  return withService((c) => emailsForRoles(c, ["Manager", "Owner"]));
}
export async function ownerEmails() {
  return withService((c) => emailsForRoles(c, ["Owner"]));
}
export async function escalationEmails() {
  return withService(async (c) =>
    (
      await c.query(
        `select u.login_email from users u join people p on p.id = u.person_id
      where u.active and p.name in (select jsonb_array_elements_text(coalesce(app.setting('escalation_recipients'), '[]'::jsonb)))`,
      )
    ).rows.map((r) => r.login_email),
  );
}
/** borrower email: login email if they have one, else stored contact (borrowers without login, FR-CHK-010) */
export async function personEmail(c: Db, personId: string): Promise<string | null> {
  const r = await c.query(`select coalesce((select login_email from users where person_id = $1 and active), (select email from people_contacts where person_id = $1)) e`, [
    personId,
  ]);
  return r.rows[0]?.e ?? null;
}
export async function userEmail(c: Db, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  return (await c.query("select login_email from users where id = $1 and active", [userId])).rows[0]?.login_email ?? null;
}
