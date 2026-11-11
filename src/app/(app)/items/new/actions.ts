"use server";
import { requireUser } from "@/lib/auth";
import { act, str, bool, num, type ActionState } from "@/lib/actions";
import { createItem, updateItem } from "@/lib/services/items";

function common(fd: FormData) {
  return {
    name: str(fd, "name").replace(/\s+/g, " "),
    brand: str(fd, "brand") || null,
    model_number: str(fd, "model_number").toUpperCase() === "TBD" ? null : str(fd, "model_number") || null,
    model_tbd: bool(fd, "model_tbd") || str(fd, "model_number").toUpperCase() === "TBD",
    serial_number: str(fd, "serial_number") || null,
    type: str(fd, "type"),
    subtype: str(fd, "subtype") || null,
    condition: str(fd, "condition"),
    owner_person_id: str(fd, "owner_person_id") || null,
    home_location_id: str(fd, "home_location_id") || null,
    parent_item_id: str(fd, "parent_item_id").toUpperCase() || null,
    case_item_id: str(fd, "case_item_id").toUpperCase() || null,
    case_capacity_note: str(fd, "case_capacity_note") || null,
    needs_case: bool(fd, "needs_case"),
    label_target: str(fd, "label_target") || "Item",
    label_note: str(fd, "label_note") || null,
    to_verify: bool(fd, "to_verify") || bool(fd, "model_tbd"),
    to_verify_reason: str(fd, "to_verify_reason") || (bool(fd, "model_tbd") ? "Model TBD" : null),
    notes: str(fd, "notes") || null,
  };
}
const fin = (fd: FormData) => ({
  purchase_date: str(fd, "purchase_date"),
  vendor: str(fd, "vendor"),
  order_ref: str(fd, "order_ref"),
  purchase_price: str(fd, "purchase_price"),
  warranty_until: str(fd, "warranty_until"),
  price_note: str(fd, "price_note"),
});

export async function create(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const f = fin(fd);
    const r = await createItem(u, {
      ...common(fd),
      quantity_mode: str(fd, "quantity_mode"),
      stock: num(fd, "stock") ?? 1,
      ...(u.financeVisible && Object.values(f).some(Boolean) ? Object.fromEntries(Object.entries(f).filter(([, v]) => v)) : {}),
    });
    return { redirectTo: `/items/${r.item_id}?created=1` };
  });
}
export async function update(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "id");
    const f = fin(fd);
    const patch: Record<string, unknown> = common(fd);
    // D-07: non-finance editors see masked notes; never write the mask back over the original text
    if (!u.financeVisible) delete patch.notes;
    await updateItem(u, id, patch, u.financeVisible && Object.values(f).some(Boolean) ? f : null);
    return { redirectTo: `/items/${id}` };
  });
}
