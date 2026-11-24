import { migrate } from "../../scripts/migrate-lib";
import { withService, withUser, callWorkflow, pool } from "@/lib/db";
import { seedPeopleAndUsers, SEED_PEOPLE, type SeededUser } from "@/lib/seed";

export const PASSWORD = "test-password-123";
/** owner and manager are Admins; team, team2 and dev are Staff (dev also has the developer flag) */
export type Users = Record<"owner" | "manager" | "team" | "team2" | "dev", SeededUser>;

export async function freshDb(): Promise<Users> {
  await migrate(process.env.MIGRATION_DATABASE_URL!, { reset: true, quiet: true });
  const users = (await withService((c) => seedPeopleAndUsers(c, PASSWORD))) as Users;
  // tests about other rules borrow to these people; the mandatory-contact rule has its own tests with a fresh borrower
  for (const p of SEED_PEOPLE) await giveContact(p.name);
  return users;
}

/** borrowers without a login have no contact details in the seed; give one an email and phone so it can borrow */
export async function giveContact(name: string, email = `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`, phone = "+91 90000 11111") {
  await withService((c) =>
    c.query(
      `insert into people_contacts(person_id, email, phone) select id, $2, $3 from people where name = $1
       on conflict (person_id) do update set email = excluded.email, phone = excluded.phone`,
      [name, email, phone],
    ),
  );
}

export async function personId(name: string): Promise<string> {
  return withService(async (c) => (await c.query("select id from people where name = $1", [name])).rows[0].id);
}

/**
 * Check-out needs purpose and due date, and check-in needs a condition (mandatory since 2026-11-24). Tests about other
 * rules get sensible values here ONLY when they leave a field out entirely; a test that passes "" or null gets the real
 * validation (see the "mandatory borrower details" tests).
 */
export function deskDefaults(name: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (name === "checkout") {
    if (!("purpose" in p)) p.purpose = "Test shoot";
    if (!("due_at" in p)) p.due_at = new Date(Date.now() + 3 * 86400_000).toISOString();
  }
  if (name === "checkin" && !("condition_in" in p)) p.condition_in = "Good";
  return p;
}

export function as(u: SeededUser) {
  return {
    wf: <T = Record<string, unknown>>(name: string, payload: unknown) => withUser(u.id, (c) => callWorkflow<T>(c, name, deskDefaults(name, payload))),
    q: <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => withUser(u.id, async (c) => (await c.query(sql, params)).rows as T[]),
  };
}

export async function svc<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return withService(async (c) => (await c.query(sql, params)).rows as T[]);
}

export async function newItem(u: SeededUser, p: Record<string, unknown>): Promise<string> {
  const r = await as(u).wf<{ item_id: string }>("create_item", { condition: "Good", ...p });
  return r.item_id;
}

/** insert a pending check-out/in photo record for rules (bytes not needed for DB rules) */
export async function photo(u: SeededUser, itemId: string, kind: string): Promise<string> {
  const r = await as(u).q<{ id: string }>(
    "insert into photos(item_id, kind, provider, provider_file_id, taken_by, upload_state) values ($1, $2, 'local', 'test', auth.uid(), 'uploaded') returning id",
    [itemId, kind],
  );
  return r[0].id;
}

export async function closePool() {
  await pool().end();
  (globalThis as Record<string, unknown>).__mtPool = undefined;
}
