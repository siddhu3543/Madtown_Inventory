import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAllowedEmail } from "./domain";

/**
 * Supabase Auth adapter (staging/production). Google provider configured in Supabase with
 * hd=madtown.in; the domain is re-checked here server-side (NFR-003). A Google account must also
 * have a provisioned row in public.users (Owner adds users in Settings) or it is refused.
 * NOTE: requires a Madtown Supabase project; not exercised in the in-workspace staging (see KNOWN_ISSUES).
 */
function client(jar: Awaited<ReturnType<typeof cookies>>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* server component */
        }
      },
    },
  });
}

export async function getSupabaseUserId(): Promise<string | null> {
  const jar = await cookies();
  const { data } = await client(jar).auth.getUser();
  const u = data.user;
  if (!u || !isAllowedEmail(u.email)) return null;
  return u.id;
}

export async function supabaseGoogleSignInUrl(redirectTo: string): Promise<string> {
  const jar = await cookies();
  const { data, error } = await client(jar).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { hd: "madtown.in", prompt: "select_account" } },
  });
  if (error || !data.url) throw new Error(error?.message ?? "OAuth start failed");
  return data.url;
}

export async function exchangeCode(code: string): Promise<string | null> {
  const jar = await cookies();
  const sb = client(jar);
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.user) return error?.message ?? "Sign-in failed";
  if (!isAllowedEmail(data.user.email)) {
    await sb.auth.signOut();
    return "Only @madtown.in accounts can sign in.";
  }
  return null;
}

export async function supabaseSignOut() {
  const jar = await cookies();
  await client(jar).auth.signOut();
}
