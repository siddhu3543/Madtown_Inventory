import { NextResponse } from "next/server";
import { supabaseGoogleSignInUrl } from "@/lib/auth/supabase";

export async function GET() {
  const url = await supabaseGoogleSignInUrl();

  if (!url) {
    return NextResponse.redirect(new URL("/login?error=oauth", process.env.APP_BASE_URL));
  }

  return NextResponse.redirect(url, 303);
}