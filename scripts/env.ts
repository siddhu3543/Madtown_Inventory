import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
/** Minimal .env loader for scripts (Next.js loads env files itself). */
export function loadEnv(file = process.env.ENV_FILE ?? ".env.local") {
  const p = join(process.cwd(), file);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
