import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { PageHeader, Section, Badge, Flag } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import * as A from "./actions";
import { fmtDateTime } from "@/lib/format";
export const metadata = { title: "Settings" };

/** SCR-22: Types, subtypes, default loan periods, reminder rules, mandatory photo rules, users and roles; Owner only */
export default async function Settings({ searchParams }: { searchParams: Promise<{ offboarded?: string }> }) {
  const u = await requireUser(["Owner"]);
  const sp = await searchParams;
  const d = await withUser(u.id, async (c) => ({
    types: (await c.query("select * from item_types order by status, sort, name")).rows,
    subtypes: (await c.query("select * from item_subtypes order by status, sort, name")).rows,
    conditions: (await c.query("select * from conditions order by rank desc")).rows,
    settings: (await c.query("select * from settings order by key")).rows,
    users: (await c.query("select us.*, p.name from users us join people p on p.id = us.person_id order by us.active desc, us.role, p.name")).rows,
    locations: (await c.query("select * from locations order by name")).rows,
    outbox: (await c.query("select * from notifications_log order by created_at desc limit 50")).rows,
    mirror: (await c.query("select * from mirror_runs order by started_at desc limit 10")).rows,
    jobs: (await c.query("select * from job_runs order by started_at desc limit 20")).rows,
  }));
  return (
    <>
      {sp.offboarded && (
        <p role="status" data-testid="offboarded" className="mb-3 rounded-md border-2 border-[var(--color-ok)] p-3 font-semibold text-[var(--color-ok)]">
          Access revoked for {sp.offboarded}. Their open sessions stop working on the next request. Follow the offboarding checklist in docs/OFFBOARDING.md.
        </p>
      )}
      <PageHeader title="Settings" sub="Owner only. Defaults marked “to confirm” come from the spec's open questions (docs/OPEN_QUESTIONS.md)." />
      <Section title="Types: default loan period and photo rules (FR-CHK-002/003, FR-CON-006)">
        <div className="overflow-x-auto">
          <table className="tbl text-sm">
            <thead>
              <tr>
                <th colSpan={7}>
                  <div className="grid grid-cols-[8rem_5rem_5rem_5rem_5rem_6rem_auto] items-center gap-2">
                    <span>Type</span>
                    <span>Loan days</span>
                    <span className="text-center">Confirmed</span>
                    <span className="text-center">Photo out</span>
                    <span className="text-center">Photo in</span>
                    <span>Service (days)</span>
                    <span />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.types
                .filter((t) => t.status === "Approved")
                .map((t) => (
                  <tr key={t.name}>
                    <td colSpan={7}>
                      <ActionForm action={A.saveType} className="grid grid-cols-[8rem_5rem_5rem_5rem_5rem_6rem_auto] items-center gap-2">
                        <input type="hidden" name="name" value={t.name} />
                        <b>{t.name}</b>
                        <input name="default_loan_days" type="number" min={1} className="input" defaultValue={t.default_loan_days ?? ""} />
                        <input type="checkbox" name="confirmed" defaultChecked={t.loan_days_confirmed} className="justify-self-center" />
                        <input type="checkbox" name="out_photo" defaultChecked={t.checkout_photo_required} className="justify-self-center" />
                        <input type="checkbox" name="in_photo" defaultChecked={t.checkin_photo_required} className="justify-self-center" />
                        <input name="service_interval_days" type="number" className="input" defaultValue={t.service_interval_days ?? ""} />
                        <Submit className="btn btn-sm btn-secondary justify-self-start">Save</Submit>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {d.types
          .filter((t) => t.status === "Proposed")
          .map((t) => (
            <ActionForm key={t.name} action={A.decideValue} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="kind" value="type" />
              <input type="hidden" name="name" value={t.name} />
              Proposed type <b>{t.name}</b>
              <Submit name="d" value="approve" className="btn btn-sm btn-primary">
                Approve
              </Submit>
              <Submit name="d" value="reject" className="btn btn-sm btn-secondary">
                Reject
              </Submit>
            </ActionForm>
          ))}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Subtypes (FR-CAT-004)">
          <p className="text-sm">
            {d.subtypes
              .filter((s) => s.status === "Approved")
              .map((s) => s.name)
              .join(", ")}
          </p>
          {d.subtypes
            .filter((s) => s.status === "Proposed")
            .map((s) => (
              <ActionForm key={s.name} action={A.decideValue} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="kind" value="subtype" />
                <input type="hidden" name="name" value={s.name} />
                Proposed <b>{s.name}</b>
                <Submit name="d" value="approve" className="btn btn-sm btn-primary">
                  Approve
                </Submit>
                <Submit name="d" value="reject" className="btn btn-sm btn-secondary">
                  Reject
                </Submit>
              </ActionForm>
            ))}
          <ActionForm action={A.proposeValue} className="mt-3 flex gap-2" resetOnSuccess>
            <select name="kind" className="input w-32">
              <option value="type">Type</option>
              <option value="subtype">Subtype</option>
            </select>
            <input name="name" className="input" required placeholder="New value" />
            <Submit className="btn btn-secondary">Add</Submit>
          </ActionForm>
        </Section>
        <Section title="Conditions (FR-CON-001, OQ-N-16)">
          <ul>
            {d.conditions.map((c) => (
              <li key={c.name} className="mb-1 flex items-center gap-2">
                <b>{c.name}</b> {c.enabled ? <Badge v="Approved" title="enabled" /> : <Flag>disabled</Flag>} <span className="muted text-sm">{c.source_note}</span>
                <ActionForm action={A.toggleCondition}>
                  <input type="hidden" name="name" value={c.name} />
                  <Submit className="btn btn-sm btn-secondary">{c.enabled ? "Disable" : "Enable"}</Submit>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Section title="Rules and reminders">
        <div className="flex flex-col gap-2">
          {d.settings
            .filter((s) => !s.is_secret)
            .map((s) => (
              <ActionForm key={s.key} action={A.saveSetting} className="grid items-center gap-2 sm:grid-cols-[14rem_1fr_auto]">
                <input type="hidden" name="key" value={s.key} />
                <span>
                  <b>{s.key}</b>
                  <br />
                  <span className="muted text-xs">{s.description}</span>
                </span>
                <input name="value" className="input" defaultValue={JSON.stringify(s.value)} />
                <Submit className="btn btn-sm btn-secondary">Save</Submit>
              </ActionForm>
            ))}
        </div>
      </Section>
      <Section title="Users and roles">
        <table className="tbl text-sm" data-testid="users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Login</th>
              <th>Role / finance / developer</th>
              <th>Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.users.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.name}
                  {!x.active && " (deactivated)"}
                </td>
                <td>{x.login_email}</td>
                <td>
                  {x.active && x.id !== u.id ? (
                    <ActionForm action={A.updateUser} className="flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={x.id} />
                      <select name="role" className="input w-36" defaultValue={x.role}>
                        {["Owner", "Manager", "Team member", "Read-only"].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                      <select name="finance_access" className="input w-36" defaultValue={x.finance_access}>
                        <option value="default">finance: role default</option>
                        <option value="on">finance: on</option>
                        <option value="off">finance: off</option>
                      </select>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" name="developer" defaultChecked={x.is_developer} /> dev
                      </label>
                      <Submit className="btn btn-sm btn-secondary">Save</Submit>
                    </ActionForm>
                  ) : (
                    `${x.role}`
                  )}
                </td>
                <td>{fmtDateTime(x.last_login)}</td>
                <td>
                  {x.active && x.id !== u.id && (
                    <ActionForm action={A.deactivate}>
                      <input type="hidden" name="id" value={x.id} />
                      <Submit className="btn btn-sm btn-danger" confirm={`Revoke ${x.login_email} now?`}>
                        Offboard
                      </Submit>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={A.addUser} className="mt-3 grid gap-2 sm:grid-cols-6" resetOnSuccess>
          <input name="name" className="input" placeholder="Name" required />
          <input name="email" type="email" className="input" placeholder="name@madtown.in" required />
          <select name="role" className="input">
            {["Team member", "Manager", "Read-only", "Owner"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          {env.authProvider === "local" ? (
            <input name="password" className="input" placeholder="Temporary password" />
          ) : (
            <span className="muted text-sm">An invite email is sent</span>
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" name="developer" /> developer
          </label>
          <Submit>Add login</Submit>
        </ActionForm>
        <p className="muted mt-2 text-sm">Add other testers only with Naveen&apos;s approval (A3). Borrowers without login are added under People.</p>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Locations (OQ-N-09)">
          <ul>
            {d.locations.map((l) => (
              <li key={l.id}>
                {l.name} · {l.location_type}
                {l.is_default_home ? " · default home" : ""}
              </li>
            ))}
          </ul>
          <ActionForm action={A.addLocation} className="mt-2 flex gap-2" resetOnSuccess>
            <input name="name" className="input" required placeholder="Name" />
            <select name="location_type" className="input">
              {["Office", "Home", "Shoot site", "Repair shop", "Storage"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <Submit className="btn btn-secondary">Add</Submit>
          </ActionForm>
        </Section>
        <Section title="Google Sheets mirror (FR-RPT-009)">
          <p className="mb-2 text-sm">One-way, nightly; target {env.mirrorProvider === "sheets" ? "Google Sheet" : "CSV files (local)"}. </p>
          <ActionForm action={A.syncNow}>
            <Submit>Sync now</Submit>
          </ActionForm>
          <ul className="mt-2 text-sm">
            {d.mirror.map((m) => (
              <li key={m.id}>
                {fmtDateTime(m.started_at)} · {m.trigger} · {m.status} · {m.rows_written ?? "—"} rows {m.error && `· ${m.error}`}
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Section title="Email outbox and notification log">
        <div className="overflow-x-auto">
          <table className="tbl text-sm" data-testid="outbox">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Status</th>
                <th>To (intended)</th>
                <th>Delivered to</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {d.outbox.map((n) => (
                <tr key={n.id}>
                  <td>{fmtDateTime(n.created_at)}</td>
                  <td>{n.event_code}</td>
                  <td>
                    {n.status}
                    {n.error && ` — ${n.error}`}
                  </td>
                  <td>{n.intended_recipients.join(", ")}</td>
                  <td>
                    {n.recipients.join(", ")}
                    {n.cc.length ? ` cc ${n.cc.join(", ")}` : ""}
                  </td>
                  <td>{n.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Jobs">
        <ul className="text-sm">
          {d.jobs.map((j) => (
            <li key={j.id}>
              {fmtDateTime(j.started_at)} · {j.job} · {j.status} · <code>{JSON.stringify(j.detail)?.slice(0, 160)}</code>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Environment">
        <p className="text-sm">
          APP_ENV {env.appEnv} · auth {env.authProvider} · storage {env.storageProvider} · email {env.emailProvider}
          {env.emailSandboxTo ? ` (sandbox → ${env.emailSandboxTo})` : ""} · mirror {env.mirrorProvider} · QR base {env.qrBaseUrl}
        </p>
      </Section>
    </>
  );
}
