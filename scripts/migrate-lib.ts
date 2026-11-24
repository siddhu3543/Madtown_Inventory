import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/** `until`: apply only migrations whose file name sorts before it (tests rebuild an older schema to check upgrades) */
export async function migrate(url: string, opts: { reset?: boolean; quiet?: boolean; until?: string } = {}) {
  const local = ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  const dir = join(__dirname, "..", "supabase", "migrations");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    if (opts.reset) {
      if (!local) throw new Error("--reset refused on non-local database");
      await c.query(`drop schema if exists public cascade; drop schema if exists app cascade; drop schema if exists auth cascade;
                     drop schema if exists extensions cascade; create schema public; grant usage on schema public to public;`);
    }
    await c.query(`create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz default now())`);
    const done = new Set((await c.query("select version from public.schema_migrations")).rows.map((r) => r.version));
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (done.has(f)) continue;
      if (opts.until && f >= opts.until) break;
      const sql = readFileSync(join(dir, f), "utf8");
      try {
        await c.query("begin");
        await c.query(sql);
        await c.query("insert into public.schema_migrations(version) values ($1)", [f]);
        await c.query("commit");
        if (!opts.quiet) console.log(`applied ${f}`);
      } catch (e) {
        await c.query("rollback");
        const err = e as Error & { position?: string };
        throw new Error(`${f}: ${err.message}${err.position ? ` (position ${err.position})` : ""}`);
      }
    }
    if (local) {
      await c.query(`grant authenticated to app_server; grant service_role to app_server; grant usage on schema public, app, auth to app_server;`);
      await c.query(`revoke all on public.schema_migrations from authenticated`);
    }
  } finally {
    await c.end();
  }
}
