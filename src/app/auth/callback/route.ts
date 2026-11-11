import { NextResponse } from "next/server";
import { env } from "@/lib/env";
/** Supabase OAuth callback; refuses non-madtown.in accounts (AC-NFR-01). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (env.authProvider !== "supabase" || !code) return NextResponse.redirect(new URL("/login", req.url));
  const { exchangeCode } = await import("@/lib/auth/supabase");
  const err = await exchangeCode(code);
  return NextResponse.redirect(new URL(err ? `/login?error=${encodeURIComponent(err)}` : "/", req.url));
}
