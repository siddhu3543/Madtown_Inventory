import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { readPhoto } from "@/lib/services/photos";
type Ctx = { params: Promise<{ id: string }> };
export const GET = api<Ctx>(async (u, req, { params }) => {
  const { id } = await params;
  const size = new URL(req.url).searchParams.get("size") === "full" ? "full" : "thumb";
  const r = await readPhoto(u, id, size);
  if ("redirect" in r) {
    if (r.redirect) return NextResponse.redirect(r.redirect);
    return new NextResponse("No file", { status: 404 });
  }
  return new NextResponse(new Uint8Array(r.bytes!), { headers: { "Content-Type": r.mime!, "Cache-Control": "private, max-age=86400" } });
});
