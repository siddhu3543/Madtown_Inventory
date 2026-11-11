import "server-only";
import { Pool, type PoolClient } from "pg";
import { env } from "./env";
import { toAppError } from "./errors";

/**
 * ADR-03: every request runs in one transaction with the caller's identity applied exactly as
 * PostgREST applies a Supabase JWT, so RLS policies are the single enforcement point.
 * The pool user (app_server) is not a superuser and has no BYPASSRLS.
 */
const g = globalThis as unknown as { __mtPool?: Pool };
export function pool(): Pool {
  if (!g.__mtPool) {
    g.__mtPool = new Pool({ connectionString: env.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
    g.__mtPool.on("error", (e) => console.error(JSON.stringify({ level: "error", msg: "pg pool error", err: e.message })));
  }
  return g.__mtPool;
}

export type Source = "App" | "Import" | "Sync" | "Job";
export type Db = PoolClient;

async function run<T>(role: "authenticated" | "service_role", claims: Record<string, unknown>, source: Source, fn: (c: Db) => Promise<T>, reason?: string): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query(
      "select set_config('request.jwt.claims', $1, true), set_config('app.source', $2, true), set_config('app.reason', $3, true), set_config('timezone', 'UTC', true)",
      [JSON.stringify(claims), source, reason ?? ""],
    );
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw toAppError(e);
  } finally {
    c.release();
  }
}

/** Run as an end user (RLS applies). */
export function withUser<T>(userId: string, fn: (c: Db) => Promise<T>, opts: { source?: Source; reason?: string } = {}) {
  return run("authenticated", { sub: userId, role: "authenticated" }, opts.source ?? "App", fn, opts.reason);
}

/** Run as the system (jobs, import, mirror). Never reachable from a browser request. */
export function withService<T>(fn: (c: Db) => Promise<T>, source: Source = "Job") {
  return run("service_role", { role: "service_role" }, source, fn);
}

/** Call a workflow function app.<name>(jsonb) and return its jsonb result. */
export async function callWorkflow<T = Record<string, unknown>>(c: Db, name: string, payload: unknown): Promise<T> {
  if (!/^[a-z_]+$/.test(name)) throw new Error("bad workflow name");
  const r = await c.query(`select app.${name}($1::jsonb) as r`, [JSON.stringify(payload)]);
  return r.rows[0].r as T;
}
