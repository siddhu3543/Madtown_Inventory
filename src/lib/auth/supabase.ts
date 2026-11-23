
import { env } from "@/lib/env";
import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isAllowedEmail } from "./domain";

function client(jar: Awaited<ReturnType<typeof cookies>>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set"
    );
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
            jar.set(name, value, options)
          );
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
  const user = data.user;

  if (!user || !isAllowedEmail(user.email)) return null;

  return user.id;
}

export async function supabasePasswordSignIn(
  email: string,
  password: string
): Promise<string | null> {
  if (!isAllowedEmail(email)) {
    return "Only @madtown.in accounts can sign in.";
  }

  const jar = await cookies();
  const sb = client(jar);

  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error || !data.user) {
    return "Email or password is incorrect.";
  }

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
export async function supabaseGoogleSignInUrl() {
  const jar = await cookies();
  const sb = client(jar);

  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${env.appBaseUrl}/auth/callback`,
      queryParams: {
        hd: "madtown.in",
        prompt: "select_account",
      },
    },
  });

  if (error) throw error;
  return data.url;
}

export async function exchangeCode(code: string) {
  const jar = await cookies();
  const sb = client(jar);

  const { error } = await sb.auth.exchangeCodeForSession(code);

  if (error) throw error;

  return getSupabaseUserId();
}