import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
/** Fresh E2E database: migrations + synthetic people/users + synthetic sheet import (scripts run with the react-server condition). */
export default async function setup() {
  const env = {
    ...process.env,
    ENV_FILE: "/nonexistent",
    APP_ENV: "e2e",
    MIGRATION_DATABASE_URL: "postgres://postgres@127.0.0.1:54322/madtown_e2e",
    DATABASE_URL: "postgres://app_server:app_server_local_only@127.0.0.1:54322/madtown_e2e",
    SEED_PASSWORD: "e2e-password-123",
  };
  execSync("npx tsx --conditions=react-server scripts/migrate.ts --reset", { env, stdio: "inherit" });
  execSync("npx tsx --conditions=react-server scripts/seed.ts", { env, stdio: "inherit" });
  for (const d of [".storage-e2e", ".mirror-e2e"]) rmSync(d, { recursive: true, force: true });
}
