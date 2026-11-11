"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, num, type ActionState } from "@/lib/actions";

export async function advance(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "event_id");
    await withUser(u.id, (c) =>
      callWorkflow(c, "advance_maintenance", {
        event_id: id,
        to_state: str(fd, "to_state") || null,
        vendor: str(fd, "vendor") || null,
        sent_at: str(fd, "sent_at") || null,
        expected_back: str(fd, "expected_back") || null,
        returned_at: str(fd, "returned_at") || null,
        outcome: str(fd, "outcome") || null,
        cause: str(fd, "cause") || null,
        cost: str(fd, "cost") || null,
        note: str(fd, "note") || null,
        condition_after: str(fd, "condition_after") || null,
      }),
    );
    return { message: "Updated.", revalidate: [`/repairs/${id}`, "/repairs"] };
  });
}
/** FR-CON-006 upkeep schedules per item or Type */
export async function addSchedule(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) =>
      c.query("insert into maintenance_schedules(item_id, item_type, interval_days, next_due, note) values (nullif($1,''), nullif($2,''), $3, $4, nullif($5,''))", [
        str(fd, "item_id").toUpperCase(),
        str(fd, "item_type"),
        num(fd, "interval_days"),
        str(fd, "next_due"),
        str(fd, "note"),
      ]),
    );
    return { message: "Schedule added.", revalidate: ["/repairs"] };
  });
}
export async function doneSchedule(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) => c.query("update maintenance_schedules set last_done = current_date, next_due = current_date + interval_days where id = $1", [str(fd, "id")]));
    return { revalidate: ["/repairs"] };
  });
}
