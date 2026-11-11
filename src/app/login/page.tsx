import { redirect } from "next/navigation";
import { getCurrentUser, localSignIn } from "@/lib/auth";
import { env } from "@/lib/env";
import { ActionForm, Submit } from "@/components/ActionForm";
import { str, type ActionState } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  const err = await localSignIn(str(fd, "email"), str(fd, "password"));
  if (err) return { error: err };
  redirect(str(fd, "next") || "/");
}

/** SCR-01: Google sign-in restricted to @madtown.in (NFR-003). */
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await getCurrentUser()) redirect(sp.next || "/");
  const google = env.authProvider === "supabase";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-4">
      <div className="card p-6">
        <h1 className="mb-1 text-2xl font-extrabold">Madtown Inventory</h1>
        <p className="muted mb-5">Sign in with your @madtown.in account.</p>
        {sp.error && (
          <p role="alert" className="mb-4 font-semibold text-[var(--color-bad)]">
            {sp.error}
          </p>
        )}
        {google ? (
          <form action="/api/auth/google" method="post">
            <button className="btn btn-primary w-full">Sign in with Google</button>
          </form>
        ) : (
          <ActionForm action={signIn} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={sp.next ?? ""} />
            <label className="field">
              <span>Email</span>
              <input className="input" name="email" type="email" autoComplete="username" required />
            </label>
            <label className="field">
              <span>Password</span>
              <input className="input" name="password" type="password" autoComplete="current-password" required />
            </label>
            <Submit>Sign in</Submit>
            <p className="muted text-sm">Local password sign-in is for the {env.appEnv} environment only. Staging and production use Google sign-in.</p>
          </ActionForm>
        )}
      </div>
    </main>
  );
}
