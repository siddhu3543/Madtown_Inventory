import "server-only";
import bcrypt from "bcryptjs";
import { withService } from "../db";
import { env } from "../env";
import { isAllowedEmail } from "./domain";
import { AppError } from "../errors";

/** Create the auth identity for a new login (Owner action). Supabase: Admin API invite; local: password account. */
export async function provisionAuthUser(email: string, tempPassword: string | null): Promise<string> {
  if (!isAllowedEmail(email)) throw new AppError("DOMAIN", "Only @madtown.in accounts can be given a login (NFR-003)");
  if (env.authProvider === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    const r = await fetch(`${url}/auth/v1/invite`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const j = await r.json();
    if (!r.ok) throw new AppError("PROVISION", `Supabase invite failed: ${j.msg ?? r.status}`);
    return j.id;
  }
  if (!tempPassword || tempPassword.length < 10) throw new AppError("PASSWORD", "Give a temporary password of at least 10 characters (local environment only)");
  const hash = await bcrypt.hash(tempPassword, 10);
  return withService(
    async (c) =>
      (
        await c.query(
          "insert into auth.users(email, encrypted_password) values ($1,$2) on conflict (email) do update set encrypted_password = excluded.encrypted_password returning id",
          [email.toLowerCase(), hash],
        )
      ).rows[0].id,
  );
}
