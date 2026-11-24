import { str, bool, num, list } from "./actions";
import { fromIstInput } from "./format";

/** FormData of the check-out form (item or kit) -> the payload services/loans.checkout validates. No silent defaults. */
export function checkoutFields(fd: FormData): Record<string, unknown> {
  return {
    item_id: str(fd, "item_id") || null,
    kit_id: str(fd, "kit_id") || null,
    borrower_person_id: str(fd, "borrower_person_id"),
    new_name: str(fd, "new_name"),
    new_email: str(fd, "new_email"),
    new_phone: str(fd, "new_phone"),
    contact_email: str(fd, "contact_email"),
    contact_phone: str(fd, "contact_phone"),
    quantity: num(fd, "quantity") ?? 1,
    purpose: str(fd, "purpose"),
    due_at: str(fd, "due_at") ? fromIstInput(str(fd, "due_at")) : "",
    condition_out: str(fd, "condition_out"),
    photo_ids: list(fd, "photo_ids"),
    override_reason: str(fd, "override_reason") || null,
    override_double: bool(fd, "override_double"),
    ack_reservation: bool(fd, "ack_reservation"),
    source_location_id: str(fd, "source_location_id") || null,
    client_uuid: str(fd, "client_uuid") || null,
  };
}
