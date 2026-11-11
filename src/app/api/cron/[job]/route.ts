import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { JOBS, runAll } from "@/lib/services/jobs";

/** Vercel Cron target. Auth: Authorization: Bearer CRON_SECRET (Vercel sends it automatically when CRON_SECRET is set). */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  const url = new URL(req.url);
  // test/staging only: simulate a clock for reminder timing checks
  const now = !env.isProductionEnv && url.searchParams.get("now") ? new Date(url.searchParams.get("now")!) : new Date();
  try {
    if (job === "all") return NextResponse.json(await runAll({ now }));
    const fn = (JOBS as Record<string, (c: { now: Date }) => Promise<unknown>>)[job];
    if (!fn) return NextResponse.json({ error: "unknown job" }, { status: 404 });
    return NextResponse.json(await fn({ now }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
export const POST = GET;
