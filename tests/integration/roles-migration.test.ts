/**
 * Upgrading a live database (2026-11-24): accounts with the old four roles become Admin or Staff, Staff lose any
 * finance access, and settings that named roles are cleaned up. Builds the pre-upgrade schema, fills it, then upgrades.
 */
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate-lib";
import { withService } from "@/lib/db";
import { closePool } from "../helpers/db";

afterAll(closePool);

describe("migration 20261124000100_admin_staff_roles on existing data", () => {
  it("maps Owner/Manager -> Admin and Team member/Read-only -> Staff, and Staff lose finance access", async () => {
    const url = process.env.MIGRATION_DATABASE_URL!;
    await migrate(url, { reset: true, quiet: true, until: "20261124000100" });
    const before = [
      ["owner.old@madtown.in", "Owner", "default"],
      ["manager.old@madtown.in", "Manager", "default"],
      ["team.old@madtown.in", "Team member", "on"],
      ["reader.old@madtown.in", "Read-only", "default"],
    ] as const;
    await withService(async (c) => {
      for (const [email, role, fin] of before) {
        const p = await c.query("insert into people(name, person_type) values ($1, 'Staff') returning id", [email]);
        const a = await c.query("insert into auth.users(email) values ($1) returning id", [email]);
        await c.query("insert into users(id, person_id, login_email, role, finance_access) values ($1,$2,$3,$4,$5)", [a.rows[0].id, p.rows[0].id, email, role, fin]);
      }
      expect((await c.query("select value from settings where key = 'finance_roles'")).rows[0].value).toEqual(["Manager", "Read-only"]);
    });

    await migrate(url, { quiet: true }); // the upgrade itself

    const after = await withService(async (c) => (await c.query("select login_email, role, finance_access from users order by login_email")).rows);
    expect(after).toEqual([
      { login_email: "manager.old@madtown.in", role: "Admin", finance_access: "default" },
      { login_email: "owner.old@madtown.in", role: "Admin", finance_access: "default" },
      { login_email: "reader.old@madtown.in", role: "Staff", finance_access: "default" },
      { login_email: "team.old@madtown.in", role: "Staff", finance_access: "default" },
    ]);
    const settings = await withService(async (c) => (await c.query("select key, value from settings where key in ('finance_roles','team_can_propose') order by key")).rows);
    expect(settings).toEqual([{ key: "finance_roles", value: [] }]);
    // and no function or policy still names an old role
    const leftovers = await withService(
      async (c) =>
        (
          await c.query(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('app','public') and p.prosrc ~ '''(Owner|Manager|Team member|Read-only)'''
            union all select policyname from pg_policies where coalesce(qual,'') || coalesce(with_check,'') ~ '(Owner|Manager|Team member|Read-only)'`)
        ).rows,
    );
    expect(leftovers).toEqual([]);
  });
});
