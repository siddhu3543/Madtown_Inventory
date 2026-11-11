"use server";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { act, str, num, bool, type ActionState } from "@/lib/actions";
import { checkout } from "@/lib/services/loans";
import { fromIstInput } from "@/lib/format";

export async function createKit(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = await withUser(
      u.id,
      async (c) => (await c.query("insert into kits(name, description) values ($1, nullif($2,'')) returning id", [str(fd, "name"), str(fd, "description")])).rows[0].id,
    );
    return { redirectTo: `/kits/${id}` };
  });
}
export async function addKitItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const kit = str(fd, "kit_id");
    const items = str(fd, "item_ids")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((x) => (/^\d+$/.test(x) ? `MTMH_${x}` : x.toUpperCase()));
    await withUser(u.id, async (c) => {
      for (const [i, it] of items.entries())
        await c.query(
          `insert into kit_items(kit_id, item_id, quantity, required, sort) values ($1,$2,$3,$4,$5)
                     on conflict (kit_id, item_id) do update set quantity = excluded.quantity, required = excluded.required`,
          [kit, it, num(fd, "quantity") ?? 1, bool(fd, "required"), i],
        );
    });
    return { message: `Added ${items.join(", ")}`, revalidate: [`/kits/${kit}`] };
  });
}
export async function updateKitItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const kit = str(fd, "kit_id");
    await withUser(u.id, (c) =>
      str(fd, "op") === "remove"
        ? c.query("delete from kit_items where kit_id = $1 and item_id = $2", [kit, str(fd, "item_id")])
        : c.query("update kit_items set required = not required where kit_id = $1 and item_id = $2", [kit, str(fd, "item_id")]),
    );
    return { revalidate: [`/kits/${kit}`] };
  });
}
export async function kitCheckout(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const r = await checkout(u, {
      kit_id: str(fd, "kit_id"),
      borrower_person_id: str(fd, "borrower_person_id") || u.personId,
      purpose: str(fd, "purpose") || null,
      due_at: fromIstInput(str(fd, "due_at")),
      condition_out: str(fd, "condition_out") || null,
      photo_ids: fd.getAll("photo_ids").map(String),
      override_reason: str(fd, "override_reason") || null,
      ack_reservation: bool(fd, "ack_reservation"),
      client_uuid: str(fd, "client_uuid") || null,
    });
    return { redirectTo: `/loans/${r.loan_id}?new=1` };
  });
}
