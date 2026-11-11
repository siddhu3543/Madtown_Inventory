"use server";
import { requireUser } from "@/lib/auth";
import { act, str, bool, num, list, type ActionState } from "@/lib/actions";
import { checkout } from "@/lib/services/loans";
import { fromIstInput } from "@/lib/format";
import { withUser } from "@/lib/db";

/** FR-CHK-001/010: borrower (default self), purpose, due date, condition, photos, quantity */
export async function doCheckout(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    let borrower = str(fd, "borrower_person_id") || u.personId;
    // FR-CHK-010: Manager records a loan for a new borrower without login, with optional phone/email
    if (borrower === "__new") {
      const name = str(fd, "new_name");
      borrower = await withUser(u.id, async (c) => {
        const p = await c.query("insert into people(name, person_type) values ($1, 'Freelancer') returning id", [name]);
        if (str(fd, "new_email") || str(fd, "new_phone"))
          await c.query("insert into people_contacts(person_id, email, phone) values ($1, nullif($2,''), nullif($3,''))", [
            p.rows[0].id,
            str(fd, "new_email"),
            str(fd, "new_phone"),
          ]);
        return p.rows[0].id;
      });
    }
    const r = await checkout(u, {
      item_id: str(fd, "item_id") || null,
      kit_id: str(fd, "kit_id") || null,
      borrower_person_id: borrower,
      quantity: num(fd, "quantity") ?? 1,
      purpose: str(fd, "purpose") || null,
      due_at: fromIstInput(str(fd, "due_at")),
      condition_out: str(fd, "condition_out") || null,
      photo_ids: list(fd, "photo_ids"),
      override_reason: str(fd, "override_reason") || null,
      override_double: bool(fd, "override_double"),
      ack_reservation: bool(fd, "ack_reservation"),
      source_location_id: str(fd, "source_location_id") || null,
      client_uuid: str(fd, "client_uuid") || null,
    });
    return { redirectTo: `/loans/${r.loan_id}?new=1${r.warnings.length ? `&w=${encodeURIComponent(r.warnings.join(","))}` : ""}` };
  });
}
