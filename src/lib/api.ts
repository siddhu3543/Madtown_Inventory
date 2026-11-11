import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "./auth";
import { toAppError } from "./errors";

/** JSON route wrapper: auth required, workflow errors -> JSON with HTTP status. */
export function api<C = unknown>(fn: (u: CurrentUser, req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    const u = await getCurrentUser();
    if (!u) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    try {
      const out = await fn(u, req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const err = toAppError(e);
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
  };
}
