"use server";
import { requireUser } from "@/lib/auth";
import { act, str, bool, num, list, type ActionState } from "@/lib/actions";
import { checkin, transfer, extend, markLost } from "@/lib/services/loans";
import { withUser, callWorkflow } from "@/lib/db";
import { fromIstInput } from "@/lib/format";

/** FR-CHK-004/005/011/014, FR-KIT-003/004 */
export async function doCheckin(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const loanId = str(fd, "loan_id");
    const lineIds = list(fd, "line_id");
    const lines = lineIds.map((id) => ({ line_id: id, returned: num(fd, `ret_${id}`) ?? 0, lost: num(fd, `lost_${id}`) ?? 0 }));
    const accessories = lineIds.map((id) => ({ line_id: id, item_id: str(fd, `item_${id}`), present: (num(fd, `ret_${id}`) ?? 0) > 0 }));
    const missing = lineIds
      .filter((id) => bool(fd, `mp_${id}`))
      .map((id) => ({ item_id: str(fd, `parent_for_mp`) || str(fd, `item_${id}`), description: `${str(fd, `item_${id}`)} not returned with kit` }));
    const extraMissing = str(fd, "missing_description") ? [{ item_id: str(fd, "missing_item_id"), description: str(fd, "missing_description") }] : [];
    const r = await checkin(u, {
      loan_id: loanId,
      lines,
      condition_in: str(fd, "condition_in") || null,
      photo_ids: list(fd, "photo_ids"),
      notes: str(fd, "notes") || null,
      complete: !bool(fd, "partial"),
      damage: bool(fd, "damage"),
      create_repair: bool(fd, "damage"),
      damage_description: str(fd, "damage_description") || null,
      backdated_at: fromIstInput(str(fd, "backdated_at")),
      backdate_reason: str(fd, "backdate_reason") || null,
      accessories,
      missing_parts: [...missing, ...extraMissing],
      lost_place: str(fd, "lost_place") || null,
    });
    const q = new URLSearchParams({ done: "1" });
    if (r.condition_worse && !r.repair_ids.length) q.set("worse", "1");
    return { redirectTo: `/loans/${loanId}?${q}` };
  });
}

export async function doTransfer(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const r = await transfer(u, { loan_id: str(fd, "loan_id"), to_person_id: str(fd, "to_person_id"), reason: str(fd, "reason"), due_at: fromIstInput(str(fd, "due_at")) });
    return { redirectTo: `/loans/${r.loan_id}?transferred=1` };
  });
}
export async function doExtend(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await extend(u, { loan_id: str(fd, "loan_id"), new_due_at: fromIstInput(str(fd, "new_due_at")), reason: str(fd, "reason") });
    return { message: "Due date extended.", revalidate: [`/loans/${str(fd, "loan_id")}`] };
  });
}
export async function doMarkLost(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await markLost(u, { loan_id: str(fd, "loan_id"), reason: str(fd, "reason"), last_seen_place: str(fd, "last_seen_place") || null });
    return { message: "Loan marked lost; an incident was opened.", revalidate: [`/loans/${str(fd, "loan_id")}`] };
  });
}
/** FR-CHK-005 one-tap repair or incident linked to the loan */
export async function oneTapRepair(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const kind = str(fd, "kind");
    await withUser(u.id, (c) =>
      kind === "repair"
        ? callWorkflow(c, "open_maintenance", {
            item_id: str(fd, "item_id"),
            type: "Repair",
            issue_description: str(fd, "description") || "Returned in worse condition",
            linked_loan_id: str(fd, "loan_id"),
          })
        : callWorkflow(c, "report_incident", {
            item_id: str(fd, "item_id"),
            type: "Damage",
            description: str(fd, "description") || "Returned in worse condition",
            linked_loan_id: str(fd, "loan_id"),
          }),
    );
    return {
      message: kind === "repair" ? "Repair opened and linked to this loan." : "Damage incident recorded and linked to this loan.",
      revalidate: [`/loans/${str(fd, "loan_id")}`],
    };
  });
}
