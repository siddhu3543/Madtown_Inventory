import { NextResponse } from "next/server";
/** FR-QR-001: stable QR path /i/<ID> — keep forever so printed labels survive domain/hosting changes (A3). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id)
    .trim()
    .toUpperCase();
  return NextResponse.redirect(new URL(`/items/${encodeURIComponent(id)}?scanned=1`, req.url), 302);
}
