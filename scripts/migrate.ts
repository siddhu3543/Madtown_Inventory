/**
 * Applies supabase/migrations/*.sql in order (Supabase CLI compatible naming).
 * Local/CI: MIGRATION_DATABASE_URL = local cluster superuser. Staging/prod: prefer `supabase db push`.
 *   --reset   drop and recreate app schemas (LOCAL/TEST ONLY; refused on non-local hosts)
 */
import { loadEnv } from "./env";
import { migrate } from "./migrate-lib";
loadEnv();
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
migrate(url, { reset: process.argv.includes("--reset") }).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
