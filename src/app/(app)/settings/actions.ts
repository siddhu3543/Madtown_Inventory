"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, num, bool, type ActionState } from "@/lib/actions";
import { provisionAuthUser } from "@/lib/auth/provision";
import { AppError } from "@/lib/errors";
import { runMirror } from "@/lib/services/mirror";

const owner = () => requireUser(["Admin"]);

export async function saveType(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    await withUser(u.id, (c) =>
      c.query(
        `update item_types set default_loan_days = $2, loan_days_confirmed = $3, checkout_photo_required = $4, checkin_photo_required = $5,
      service_interval_days = $6 where name = $1`,
        [str(fd, "name"), num(fd, "default_loan_days"), bool(fd, "confirmed"), bool(fd, "out_photo"), bool(fd, "in_photo"), num(fd, "service_interval_days")],
      ),
    );
    return { message: "Saved.", revalidate: ["/settings"] };
  });
}
/** FR-CAT-003: Managers add a value; the Owner approves */
export async function proposeValue(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser(["Admin"]);
    const table = str(fd, "kind") === "subtype" ? "item_subtypes" : "item_types";
    await withUser(u.id, (c) => c.query(`insert into ${table}(name, status, proposed_by) values ($1, $2, auth.uid())`, [str(fd, "name"), "Approved"]));
    return { message: "Added.", revalidate: ["/settings"] };
  });
}
export async function decideValue(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    const table = str(fd, "kind") === "subtype" ? "item_subtypes" : "item_types";
    await withUser(u.id, (c) =>
      c.query(`update ${table} set status = $2, approved_by = auth.uid(), approved_at = now() where name = $1`, [
        str(fd, "name"),
        str(fd, "d") === "approve" ? "Approved" : "Rejected",
      ]),
    );
    return { revalidate: ["/settings"] };
  });
}
export async function toggleCondition(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    await withUser(u.id, (c) => c.query("update conditions set enabled = not enabled where name = $1", [str(fd, "name")]));
    return { revalidate: ["/settings"] };
  });
}
export async function saveSetting(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    let v: unknown = str(fd, "value");
    try {
      v = JSON.parse(String(v));
    } catch {
      /* plain string */
    }
    await withUser(u.id, (c) => c.query("update settings set value = $2, updated_by = auth.uid(), updated_at = now() where key = $1", [str(fd, "key"), JSON.stringify(v)]));
    return { message: `Saved ${str(fd, "key")}.`, revalidate: ["/settings"] };
  });
}
const ROLES = ["Admin", "Staff"];
function role(fd: FormData) {
  const r = str(fd, "role");
  if (!ROLES.includes(r)) throw new AppError("BAD_ROLE", "Role must be Admin or Staff");
  return r;
}
/** Users and roles (SCR-22). Admin only. Two roles: Admin (everything) and Staff (check-out / check-in desk). */
export async function addUser(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    const email = str(fd, "email").toLowerCase();
    const authId = await provisionAuthUser(email, str(fd, "password") || null);
    await withUser(u.id, async (c) => {
      const p = await c.query(`insert into people(name, person_type) values ($1, 'Staff') on conflict (lower(name)) do update set name = excluded.name returning id`, [
        str(fd, "name"),
      ]);
      await c.query(`insert into users(id, person_id, login_email, role, is_developer, finance_access) values ($1,$2,$3,$4,$5,$6)`, [
        authId,
        p.rows[0].id,
        email,
        role(fd),
        bool(fd, "developer"),
        "default",
      ]);
    });
    return { message: `Login created for ${email}.`, revalidate: ["/settings"] };
  });
}
export async function updateUser(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    await withUser(u.id, (c) =>
      // a role change ends that person's sessions at once (session_version), so new limits apply immediately
      c.query("update users set role = $2, is_developer = $3, session_version = session_version + case when role <> $2 then 1 else 0 end where id = $1", [
        str(fd, "id"),
        role(fd),
        bool(fd, "developer"),
      ]),
    );
    return { message: "User updated.", revalidate: ["/settings"] };
  });
}
/** NFR-006: same-day offboarding — access revoked on the next request */
export async function deactivate(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    const email = await withUser(u.id, async (c) => {
      await callWorkflow(c, "deactivate_user", { user_id: str(fd, "id") });
      return (await c.query("select login_email from users where id = $1", [str(fd, "id")])).rows[0]?.login_email as string;
    });
    return { redirectTo: `/settings?offboarded=${encodeURIComponent(email)}` };
  });
}
export async function addLocation(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser(["Admin"]);
    await withUser(u.id, (c) => c.query("insert into locations(name, location_type) values ($1,$2)", [str(fd, "name"), str(fd, "location_type")]));
    return { revalidate: ["/settings"] };
  });
}
/** A4: Owner-triggered manual sync of the read-only mirror */
export async function syncNow(): Promise<ActionState> {
  return act(async () => {
    const u = await owner();
    const r = await runMirror("manual", u.id);
    return { message: `Mirror written: ${r.rows} items to ${r.target}.`, revalidate: ["/settings"] };
  });
}
