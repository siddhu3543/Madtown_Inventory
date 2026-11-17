
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { withService, withUser } from "../db";
import { env } from "../env";
import { isAllowedEmail } from "./domain";
import {
  SESSION_COOKIE,
  sessionMaxAge,
  signSession,
  verifySession,
} from "./session";

export type Role = "Owner" | "Manager" | "Team member" | "Read-only";

export type CurrentUser = {
  id: string;
  personId: string;
  name: string;
  email: string;
  role: Role;
  isDeveloper: boolean;
  financeVisible: boolean;
  sessionVersion: number;
};

/**
 * ADR-08 AuthAdapter.
 * "local" = password accounts in the local shim.
 * "supabase" = Supabase Auth with email/password.
 */
function assertLocalAllowed() {
  if (
    env.authProvider === "local" &&
    env.isProductionEnv &&
    process.env.ALLOW_LOCAL_AUTH !== "1"
  ) {
    throw new Error(
      "Local password auth is disabled in production. Set AUTH_PROVIDER=supabase."
    );
  }
}

async function loadUser(
  userId: string,
  sv: number | null
): Promise<CurrentUser | null> {
  return withUser(userId, async (c) => {
    const r = await c.query(
      `select u.id, u.person_id, p.name, u.login_email, u.role,
              u.is_developer, u.session_version,
              app.can_view_financials() as fin
         from users u
         join people p on p.id = u.person_id
        where u.id = auth.uid() and u.active`
    );

    const u = r.rows[0];

    if (!u) return null;
    if (sv !== null && u.session_version !== sv) return null;

    return {
      id: u.id,
      personId: u.person_id,
      name: u.name,
      email: u.login_email,
      role: u.role,
      isDeveloper: u.is_developer,
      financeVisible: u.fin,
      sessionVersion: u.session_version,
    };
  }).catch(() => null);
}

export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    if (env.authProvider === "supabase") {
      const { getSupabaseUserId } = await import("./supabase");
      const uid = await getSupabaseUserId();
      return uid ? loadUser(uid, null) : null;
    }

    assertLocalAllowed();

    const jar = await cookies();
    const claims = await verifySession(
      jar.get(SESSION_COOKIE)?.value
    );

    return claims ? loadUser(claims.sub, claims.sv) : null;
  }
);

export async function requireUser(
  roles?: Role[]
): Promise<CurrentUser> {
  const u = await getCurrentUser();

  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect("/forbidden");

  return u;
}

/** Local provider sign-in. Returns error text or null. */
export async function localSignIn(
  email: string,
  password: string
): Promise<string | null> {
  assertLocalAllowed();

  if (!isAllowedEmail(email)) {
    return "Only @madtown.in accounts can sign in.";
  }

  const row = await withService(async (c) => {
    const r = await c.query(
      `select a.id, a.encrypted_password, u.active, u.session_version
         from auth.users a
         join users u on u.id = a.id
        where lower(a.email) = lower($1)`,
      [email.trim()]
    );

    return r.rows[0];
  });

  if (
    !row ||
    !row.encrypted_password ||
    !(await bcrypt.compare(password, row.encrypted_password))
  ) {
    return "Email or password is incorrect.";
  }

  if (!row.active) {
    return "This account has been deactivated.";
  }

  await withService((c) =>
    c.query("update users set last_login = now() where id = $1", [
      row.id,
    ])
  );

  const token = await signSession({
    sub: row.id,
    sv: row.session_version,
  });

  const jar = await cookies();

  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appBaseUrl.startsWith("https"),
    path: "/",
    maxAge: sessionMaxAge,
  });

  return null;
}

/**
 * Provider-aware email/password sign-in.
 * Supabase verifies the password; the application database
 * verifies that the user is active and provisioned.
 */
export async function passwordSignIn(
  email: string,
  password: string
): Promise<string | null> {
  if (env.authProvider !== "supabase") {
    return localSignIn(email, password);
  }

  if (!isAllowedEmail(email)) {
    return "Only @madtown.in accounts can sign in.";
  }

  const { supabasePasswordSignIn, getSupabaseUserId, supabaseSignOut } =
    await import("./supabase");

  const error = await supabasePasswordSignIn(email, password);

  if (error) return error;

  const userId = await getSupabaseUserId();

  if (!userId) {
    await supabaseSignOut();
    return "Unable to verify your account.";
  }

  const user = await loadUser(userId, null);

  if (!user) {
    await supabaseSignOut();
    return "Your account is not active or has not been provisioned.";
  }

  await withService((c) =>
    c.query("update users set last_login = now() where id = $1", [
      userId,
    ])
  );

  return null;
}

export async function signOut() {
  const jar = await cookies();

  jar.delete(SESSION_COOKIE);

  if (env.authProvider === "supabase") {
    const { supabaseSignOut } = await import("./supabase");
    await supabaseSignOut();
  }
}
