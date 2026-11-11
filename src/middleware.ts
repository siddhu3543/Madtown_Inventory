import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: no session cookie -> login. Full verification (signature, active, session_version) happens server-side per request. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname === "/api/health" ||
    pathname === "/offline";
  if (open) return NextResponse.next();
  const hasSession = req.cookies.get("mt_session") || [...req.cookies.getAll()].some((c) => c.name.startsWith("sb-"));
  if (!hasSession) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    const u = req.nextUrl.clone();
    u.pathname = "/login";
    u.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(u);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
