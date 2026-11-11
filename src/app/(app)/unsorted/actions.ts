"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, num, bool, type ActionState } from "@/lib/actions";
import { AppError } from "@/lib/errors";

export async function updateRow(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) =>
      c.query("update unsorted_items set status = $2, notes = nullif($3,''), duplicate_cleared = $4 where id = $1", [
        str(fd, "id"),
        str(fd, "status"),
        str(fd, "notes"),
        bool(fd, "duplicate_cleared"),
      ]),
    );
    return { revalidate: ["/unsorted"] };
  });
}
/** MIG-012: convert to an item only after a Manager fills the required fields; GoPro becomes Missing (MIG-012, OQ-N-14). */
export async function convert(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "id");
    const out = await withUser(u.id, async (c) => {
      const row = (await c.query("select * from unsorted_items where id = $1 for update", [id])).rows[0];
      if (!row) throw new AppError("NOT_FOUND", "Row not found");
      if (row.duplicate_of_item_id && !row.duplicate_cleared)
        throw new AppError("DUPLICATE", `Possible duplicate of ${row.duplicate_of_item_id}: verify and tick "not a duplicate" first (MIG-013)`);
      const r = await callWorkflow<{ item_id: string }>(c, "create_item", {
        name: str(fd, "name"),
        type: str(fd, "type"),
        model_number: str(fd, "model_number") || null,
        quantity_mode: str(fd, "quantity_mode"),
        stock: num(fd, "stock") ?? 1,
        condition: str(fd, "condition"),
        notes: `From Not yet sorted: ${row.item}. ${row.known ?? ""}`.trim(),
        to_verify: true,
        to_verify_reason: `Converted from unsorted row ${row.sheet_row ?? ""}`,
      });
      if (bool(fd, "missing"))
        await callWorkflow(c, "report_incident", {
          item_id: r.item_id,
          type: "Loss",
          mark: "Missing",
          description: `Missing: to locate (from Not yet sorted: ${row.item})`,
          history_known: false,
        });
      await c.query("update unsorted_items set status = 'Converted', converted_item_ids = array_append(converted_item_ids, $2) where id = $1", [id, r.item_id]);
      return r.item_id;
    });
    return { redirectTo: `/items/${out}` };
  });
}
