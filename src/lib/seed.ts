/**
 * People and login accounts for staging/test (A3: synthetic data, no personal contact data).
 * Names are those in the sheet/briefing (section 2); emails are placeholders on madtown.in and
 * must be replaced by the real accounts Naveen approves (A3 "Add other named testers only with
 * Naveen's approval"). Borrowers without login get no contact data here.
 */
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";

export const SEED_USERS = [
  { key: "owner", name: "Naveen Pinapatruni", email: "naveen@madtown.in", role: "Owner", type: "Staff", developer: false },
  { key: "manager", name: "Anand", email: "anand@madtown.in", role: "Manager", type: "Staff", developer: false },
  { key: "team", name: "Test Team Member", email: "team.tester@madtown.in", role: "Team member", type: "Staff", developer: false },
  { key: "team2", name: "Second Team Member", email: "team.tester2@madtown.in", role: "Team member", type: "Staff", developer: false },
  { key: "readonly", name: "Accountant (test)", email: "accounts.tester@madtown.in", role: "Read-only", type: "Staff", developer: false },
  { key: "dev", name: "Siddharth", email: "siddharth.dev@madtown.in", role: "Read-only", type: "Staff", developer: true },
] as const;

// Borrowers without login (section 2). Kittu: Manager proposed but unconfirmed (D-26) -> person only.
export const SEED_PEOPLE = [
  { name: "Kittu", type: "Freelancer", toVerify: true, note: "Proposed Manager (Sheldon Cooper); staff or freelancer to confirm (OQ-N-01)" },
  { name: "Nagi", type: "Freelancer", toVerify: true, note: "Staff or freelancer to confirm (OQ-N-01)" },
  { name: "Chiru", type: "Freelancer", toVerify: false, note: "Borrower without login" },
  { name: "Purushotham", type: "Freelancer", toVerify: false, note: "Appears in Notes only" },
  { name: "Samuel", type: "Freelancer", toVerify: false, note: "Appears in Notes only" },
] as const;

export type SeededUser = { id: string; personId: string; email: string; role: string; name: string };

export async function seedPeopleAndUsers(c: PoolClient, password: string): Promise<Record<string, SeededUser>> {
  const out: Record<string, SeededUser> = {};
  const hash = await bcrypt.hash(password, 10);
  for (const u of SEED_USERS) {
    const p = await c.query(
      `insert into people(name, person_type) values ($1, $2)
       on conflict (lower(name)) do update set name = excluded.name returning id`,
      [u.name, u.type],
    );
    const au = await c.query(
      `insert into auth.users(email, encrypted_password) values ($1, $2)
       on conflict (email) do update set encrypted_password = excluded.encrypted_password returning id`,
      [u.email, hash],
    );
    await c.query(
      `insert into users(id, person_id, login_email, role, is_developer, finance_access)
       values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set role = excluded.role, active = true`,
      [au.rows[0].id, p.rows[0].id, u.email, u.role, u.developer, u.developer ? "off" : "default"],
    );
    out[u.key] = { id: au.rows[0].id, personId: p.rows[0].id, email: u.email, role: u.role, name: u.name };
  }
  for (const p of SEED_PEOPLE) {
    await c.query(
      `insert into people(name, person_type, person_type_to_verify, notes) values ($1, $2, $3, $4)
       on conflict (lower(name)) do nothing`,
      [p.name, p.type, p.toVerify, p.note],
    );
  }
  return out;
}
