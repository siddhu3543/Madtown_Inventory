import { api } from "@/lib/api";
import { getItemFull } from "@/lib/services/items";
import { AppError } from "@/lib/errors";
type Ctx = { params: Promise<{ id: string }> };
/** JSON item API. Financial data only appears when the caller's role may see it (NFR-004, AC-NFR-02). */
export const GET = api<Ctx>(async (u, _req, { params }) => {
  const d = await getItemFull(u, decodeURIComponent((await params).id).toUpperCase());
  if (!d) throw new AppError("NOT_FOUND", "Item not found", 404);
  return d;
});
