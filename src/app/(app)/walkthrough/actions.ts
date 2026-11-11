"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, num, list, type ActionState } from "@/lib/actions";
import { notify, managersAndOwner } from "@/lib/services/notifications";

export async function start(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = await withUser(
      u.id,
      async (c) =>
        (
          await c.query("insert into audits(scope_kind, scope_value, started_by, note) values ($1, nullif($2,''), auth.uid(), nullif($3,'')) returning id", [
            str(fd, "scope_kind"),
            str(fd, "scope_value"),
            str(fd, "note"),
          ])
        ).rows[0].id,
    );
    return { redirectTo: `/walkthrough/${id}` };
  });
}
/** FR-AUD-003/004/007: scan result, counted qty, optional photo and quick note */
export async function record(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "audit_id");
    const r = await withUser(u.id, (c) =>
      callWorkflow<{ found_candidate: boolean }>(c, "record_audit_line", {
        audit_id: id,
        item_id: str(fd, "item_id").toUpperCase(),
        result: str(fd, "result"),
        counted_qty: num(fd, "counted_qty"),
        condition_seen: str(fd, "condition_seen") || null,
        location_seen_id: str(fd, "location_seen_id") || null,
        photo_id: list(fd, "photo_ids")[0] ?? null,
        note: str(fd, "note") || null,
      }),
    );
    return {
      message: r.found_candidate ? `Recorded. ${str(fd, "item_id")} is Lost/Missing — open it and use Mark as found.` : `Recorded ${str(fd, "item_id")}.`,
      revalidate: [`/walkthrough/${id}`],
    };
  });
}
/** FR-AUD-005 + NTF-014 */
export async function close(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "audit_id");
    const v = await withUser(u.id, async (c) => {
      await c.query("update audits set status = 'Closed', closed_at = now(), closed_by = auth.uid() where id = $1 and status = 'Open'", [id]);
      return (
        await c.query(
          `select item_id, result, expected_qty, counted_qty from audit_lines where audit_id = $1 and (result <> 'Found' or (counted_qty is not null and counted_qty <> expected_qty))`,
          [id],
        )
      ).rows;
    });
    const notFound = Number(str(fd, "not_scanned") || 0);
    await notify({
      code: "NTF-014",
      dedupe: `NTF-014:${id}`,
      to: await managersAndOwner(),
      subject: `Walkthrough variance: ${v.length} line(s), ${notFound} not scanned`,
      text: v.map((x) => `- ${x.item_id}: ${x.result}${x.counted_qty != null ? ` counted ${x.counted_qty} vs ${x.expected_qty}` : ""}`).join("\n") || "No variances.",
    });
    return { message: "Walkthrough closed. Review the variance report.", revalidate: [`/walkthrough/${id}`] };
  });
}
export async function correct(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "audit_id");
    const action = str(fd, "action");
    const payload: Record<string, unknown> = { line_id: str(fd, "line_id"), action, note: str(fd, "note") || null };
    await withUser(u.id, async (c) => {
      if (action === "set_count") {
        // keep units already recorded Lost/In repair; shelf count replaces Available; shortfall -> Missing
        const keep = (
          await c.query(
            `select h.status, h.quantity, h.holder_person_id, h.holder_location_id from item_holdings h join audit_lines l on l.item_id = h.item_id
                                      where l.id = $1 and h.loan_line_id is null and h.status in ('Lost','In repair') and h.quantity > 0`,
            [str(fd, "line_id")],
          )
        ).rows;
        payload.holdings = [
          { location_id: str(fd, "location_id"), status: "Available", quantity: num(fd, "available_qty") ?? 0 },
          ...(num(fd, "missing_qty") ? [{ status: "Missing", quantity: num(fd, "missing_qty") }] : []),
          ...keep.map((k) => ({ status: k.status, quantity: k.quantity, person_id: k.holder_person_id, location_id: k.holder_location_id })),
        ];
      }
      await callWorkflow(c, "apply_audit_correction", payload);
    });
    return { message: "Correction applied and logged.", revalidate: [`/walkthrough/${id}`] };
  });
}
/** FR-AUD-006: not found -> Missing in bulk with one confirmation */
export async function bulkMissing(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "audit_id");
    const items = list(fd, "item_id");
    await withUser(u.id, async (c) => {
      for (const it of items) {
        const line = await callWorkflow<{ line_id: string }>(c, "record_audit_line", { audit_id: id, item_id: it, result: "Not found" });
        await callWorkflow(c, "apply_audit_correction", { line_id: line.line_id, action: "mark_missing", note: "Bulk: not found in walkthrough" });
      }
    });
    return { message: `${items.length} item(s) moved to Missing.`, revalidate: [`/walkthrough/${id}`] };
  });
}
