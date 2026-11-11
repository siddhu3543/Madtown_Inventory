import { NextResponse } from "next/server";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id)
    .trim()
    .toUpperCase();
  return NextResponse.redirect(new URL(`/kits/${encodeURIComponent(id)}?scanned=1`, req.url), 302);
}
