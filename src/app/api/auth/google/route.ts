import { NextResponse } from "next/server";
import { env } from "@/lib/env";
export async function POST() {
  if (env.authProvider !== "supabase") return NextResponse.json({ error: "Google sign-in not configured" }, { status: 400 });
  const { supabaseGoogleSignInUrl } = await import("@/lib/auth/supabase");
  return NextResponse.redirect(await supabaseGoogleSignInUrl(`${env.appBaseUrl}/auth/callback`), 303);
}
