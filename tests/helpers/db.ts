import { migrate } from "../../scripts/migrate-lib";
import { withService, withUser, callWorkflow, pool } from "@/lib/db";
import { seedPeopleAndUsers, type SeededUser } from "@/lib/seed";

export const PASSWORD = "test-password-123";
export type Users = Record<"owner" | "manager" | "team" | "team2" | "readonly" | "dev", SeededUser>;

export async function freshDb(): Promise<Users> {
  await migrate(process.env.MIGRATION_DATABASE_URL!, { reset: true, quiet: true });
  return (await withService((c) => seedPeopleAndUsers(c, PASSWORD))) as Users;
}

export async function personId(name: string): Promise<string> {
  return withService(async (c) => (await c.query("select id from people where name = $1", [name])).rows[0].id);
}

export function as(u: SeededUser) {
  return {
    wf: <T = Record<string, unknown>>(name: string, payload: unknown) => withUser(u.id, (c) => callWorkflow<T>(c, name, payload)),
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
