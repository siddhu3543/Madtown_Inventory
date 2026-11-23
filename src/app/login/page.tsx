
import { redirect } from "next/navigation";
import { AlertCircle, Boxes, QrCode, ShieldCheck, WifiOff } from "lucide-react";
import { getCurrentUser, passwordSignIn } from "@/lib/auth";
import { env } from "@/lib/env";
import { ActionForm, Submit } from "@/components/ActionForm";
import { str, type ActionState } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";

  const err = await passwordSignIn(
    str(fd, "email"),
    str(fd, "password")
  );

  if (err) return { error: err };

  redirect(str(fd, "next") || "/");
}

const POINTS = [
  {
    icon: QrCode,
    title: "Scan and go",
    text: "Check equipment out and in from any phone by scanning its QR label.",
  },
  {
    icon: Boxes,
    title: "One source of truth",
    text: "Items, kits, loans, repairs and purchasing in a single place.",
  },
  {
    icon: WifiOff,
    title: "Works on location",
    text: "Look things up and queue check-outs even when the signal drops.",
  },
];

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;

  if (await getCurrentUser()) redirect(sp.next || "/");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
      <aside className="relative hidden overflow-hidden bg-[#0f1b4d] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -top-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-[#2547d0] opacity-30 blur-3xl"
          aria-hidden
        />

        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-bold text-[#0f1b4d]">
            M
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Madtown Inventory
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            Know where every piece of equipment is.
          </h2>

          <ul className="mt-10 flex flex-col gap-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <p.icon size={20} aria-hidden />
                </span>
                <div>
                  <p className="font-semibold">{p.title}</p>
                  <p className="mt-0.5 text-[0.9375rem] text-white/70">
                    {p.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-white/50">
          Madtown · internal equipment management
        </p>
      </aside>

      <main className="flex min-h-screen flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-brand)] text-lg font-bold text-[var(--color-brand-ink)]">
              M
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Madtown Inventory
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in
          </h1>

          <p className="muted mt-1.5 mb-6">
            Use your @madtown.in account to continue.
          </p>

          {sp.error && (
            <p role="alert" className="alert alert-bad mb-4 font-medium">
              <AlertCircle size={18} aria-hidden />
              {sp.error}
            </p>
          )}

          <ActionForm action={signIn} className="flex flex-col gap-4">
            <input
              type="hidden"
              name="next"
              value={sp.next ?? ""}
            />

            <label className="field">
              <span>Email</span>
              <input
                className="input"
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@madtown.in"
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                className="input"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>

            <Submit className="btn btn-primary w-full">
              Sign in
            </Submit>

            <p className="muted flex gap-2 text-sm">
              <ShieldCheck
                size={16}
                aria-hidden
                className="mt-0.5 shrink-0"
              />
              <span>
                Secure sign-in through Supabase authentication.
                Only authorized, active Madtown users can access the platform.
              </span>
            </p>
          </ActionForm>
        </div>
      </main>
    </div>
  );
}
