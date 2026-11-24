"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, bool, num, list, type ActionState } from "@/lib/actions";
import { lostNotice } from "@/lib/services/loans";
import { notify, managerEmails, ownerEmails } from "@/lib/services/notifications";
import { promoteLatest, setStockImage } from "@/lib/services/photos";
import { fromIstInput } from "@/lib/format";

const path = (id: string) => `/items/${id}`;

/** FR-LST-002/003/004, FR-QR-003 "Report issue" */
export async function reportIssue(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    const r = await withUser(u.id, (c) =>
      callWorkflow<{ incident_id: string; on_loan: boolean }>(c, "report_incident", {
        item_id: id,
        type: str(fd, "type"),
        quantity: num(fd, "quantity") ?? 1,
        description: str(fd, "description"),
        mark: str(fd, "mark") || null,
        history_known: !bool(fd, "history_unknown"),
        last_seen_at: str(fd, "last_seen_at") || null,
        last_seen_place: str(fd, "last_seen_place") || null,
        responsible_person_id: str(fd, "responsible_person_id") || null,
        photo_ids: list(fd, "photo_ids"),
      }),
    );
    if (str(fd, "type") !== "Damage") await lostNotice([r.incident_id], u);
    else
      await notify({
        code: "NTF-005",
        dedupe: `NTF-005:incident:${r.incident_id}`,
        to: await managerEmails(),
        itemId: id,
        subject: `Damage reported: ${id}`,
        text: `${u.name} reported damage on ${id}: ${str(fd, "description")}`,
      });
    return { message: r.on_loan ? "Incident recorded. The item is on a loan — a Manager should mark the loan lost or check it in." : "Incident recorded.", revalidate: [path(id)] };
  });
}

/** FR-LST-007 / AC-LST-03: Mark as found, records where and by whom, notifies the Manager */
export async function markFound(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    await withUser(u.id, (c) =>
      callWorkflow(c, "mark_found", {
        item_id: id,
        place: str(fd, "place"),
        quantity: num(fd, "quantity") ?? 1,
        location_id: str(fd, "location_id") || null,
        condition: str(fd, "condition") || null,
        note: str(fd, "note") || null,
      }),
    );
    await notify({
      code: "FOUND",
      dedupe: `FOUND:${id}:${Date.now()}`,
      to: await managerEmails(),
      itemId: id,
      subject: `Found: ${id}`,
      text: `${u.name} marked ${id} as found at "${str(fd, "place")}".`,
    });
    return { redirectTo: `${path(id)}?found=1` };
  });
}

/** FR-KIT-005 missing parts, linked to a to-buy line */
export async function addMissingPart(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    await withUser(u.id, (c) =>
      c.query("insert into missing_parts(item_id, description, quantity, reported_by, wishlist_id) values ($1,$2,$3,auth.uid(),$4)", [
        id,
        str(fd, "description"),
        num(fd, "quantity") ?? 1,
        str(fd, "wishlist_id") || null,
      ]),
    );
    return { message: "Missing part recorded.", revalidate: [path(id)] };
  });
}
export async function updateMissingPart(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    const status = str(fd, "status");
    await withUser(u.id, (c) =>
      c.query(
        `update missing_parts set status = coalesce(nullif($2,''), status), wishlist_id = coalesce(nullif($3,'')::uuid, wishlist_id),
              resolved_at = case when nullif($2,'') is not null and $2 <> 'Missing' then now() else resolved_at end,
              resolved_by = case when nullif($2,'') is not null and $2 <> 'Missing' then auth.uid() else resolved_by end where id = $1`,
        [str(fd, "id"), status, str(fd, "wishlist_id")],
      ),
    );
    return { revalidate: [path(id)] };
  });
}

/** FR-CON-010 / FR-KIT-005: create a linked to-buy line in one step from a defect or missing part */
export async function toBuyFromDefect(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    await withUser(u.id, async (c) => {
      const w = await c.query(
        `insert into wishlist_items(item_description, reason, replaces_or_adds, priority, status, source_missing_part_id)
                               values ($1,$2,$3,$4,'To buy',$5) returning id`,
        [str(fd, "description"), str(fd, "reason"), str(fd, "replaces_or_adds") || "Replaces", str(fd, "priority") || "Medium", str(fd, "missing_part_id") || null],
      );
      await c.query("insert into wishlist_related_items(wishlist_id, item_id) values ($1,$2)", [w.rows[0].id, id]);
      // linking the missing part is a Manager update (RLS); a Team member's proposal keeps source_missing_part_id for the Manager to confirm
      if (str(fd, "missing_part_id") && u.role === "Admin") await c.query("update missing_parts set wishlist_id = $1 where id = $2", [w.rows[0].id, str(fd, "missing_part_id")]);
      return w.rows[0].id;
    });
    await notify({
      code: "NTF-010",
      dedupe: null,
      to: await ownerEmails(),
      itemId: id,
      subject: `To-buy proposed: ${str(fd, "description")}`,
      text: `${u.name} proposed "${str(fd, "description")}" for ${id}. Reason: ${str(fd, "reason")}`,
    });
    return { message: "To-buy line created and linked.", revalidate: [path(id)] };
  });
}

/** FR-KIT-006 detached accessories held by someone else */
export async function addDetached(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    await withUser(u.id, (c) =>
      c.query("insert into detached_accessories(item_id, description, holder_person_id, reason, created_by) values ($1,$2,$3,$4,auth.uid())", [
        id,
        str(fd, "description"),
        str(fd, "holder_person_id"),
        str(fd, "reason") || null,
      ]),
    );
    return { revalidate: [path(id)] };
  });
}
export async function returnDetached(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) => c.query("update detached_accessories set returned_at = now() where id = $1", [str(fd, "id")]));
    return { revalidate: [path(str(fd, "item_id"))] };
  });
}

/** FR-CON-002 open a maintenance event */
export async function openRepair(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    await withUser(u.id, (c) =>
      callWorkflow(c, "open_maintenance", {
        item_id: id,
        type: str(fd, "type") || "Repair",
        state: str(fd, "state") || "Reported",
        issue_description: str(fd, "issue_description"),
        cause: str(fd, "cause") || null,
        vendor: str(fd, "vendor") || null,
        expected_back: str(fd, "expected_back") || null,
        sent_at: str(fd, "sent_at") || null,
        quantity: num(fd, "quantity") ?? 1,
        cost: str(fd, "cost") || null,
        linked_loan_id: str(fd, "linked_loan_id") || null,
        linked_incident_id: str(fd, "linked_incident_id") || null,
      }),
    );
    return { message: "Maintenance event opened.", revalidate: [path(id)] };
  });
}

/** FR-CAT-013 retire / sell / write off with reason and Owner approval */
export async function requestRetire(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    const r = await withUser(u.id, (c) => callWorkflow<{ status: string }>(c, "request_retirement", { item_id: id, kind: str(fd, "kind"), reason: str(fd, "reason") }));
    if (r.status === "Pending")
      await notify({
        code: "RETIRE",
        dedupe: null,
        to: await ownerEmails(),
        itemId: id,
        subject: `Approval needed: ${str(fd, "kind")} ${id}`,
        text: `${u.name} proposes: ${str(fd, "kind")} ${id}. Reason: ${str(fd, "reason")}`,
      });
    return { message: r.status === "Pending" ? "Sent to an Admin for approval." : "Item retired.", revalidate: [path(id)] };
  });
}
export async function decideRetire(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) =>
      callWorkflow(c, "decide_retirement", { request_id: str(fd, "request_id"), approve: str(fd, "decision") === "approve", comment: str(fd, "comment") }),
    );
    return { revalidate: [path(str(fd, "item_id"))] };
  });
}
export async function deleteItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) => callWorkflow(c, "delete_item_created_in_error", { item_id: str(fd, "item_id"), reason: str(fd, "reason") }));
    return { redirectTo: "/items" };
  });
}

/** FR-CAT-007 split Counted into tagged units */
export async function splitItem(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    const r = await withUser(u.id, (c) => callWorkflow<{ units: string[] }>(c, "split_counted", { item_id: id, reason: str(fd, "reason") }));
    return { message: `Created ${r.units.length} units: ${r.units.join(", ")}. Print their labels.`, revalidate: [path(id)] };
  });
}

/** Counted holdings / stock correction with reason (FR-CAT-006, R-06) */
export async function adjustStock(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    const holders = list(fd, "h_holder"),
      statuses = list(fd, "h_status"),
      qtys = fd.getAll("h_qty").map(String);
    const holdings = holders
      .map((h, i) => ({
        status: statuses[i],
        quantity: Number(qtys[i] || 0),
        person_id: h.startsWith("p:") ? h.slice(2) : null,
        location_id: h.startsWith("l:") ? h.slice(2) : null,
      }))
      .filter((h) => h.quantity > 0);
    await withUser(u.id, (c) => callWorkflow(c, "adjust_stock", { item_id: id, reason: str(fd, "reason"), holdings, stock_to_verify: bool(fd, "stock_to_verify") }));
    return { message: "Stock updated.", revalidate: [path(id)] };
  });
}
export async function setCustodian(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    const h = str(fd, "holder");
    await withUser(u.id, (c) =>
      callWorkflow(c, "set_custodian", {
        item_id: id,
        reason: str(fd, "reason"),
        person_id: h.startsWith("p:") ? h.slice(2) : null,
        location_id: h.startsWith("l:") ? h.slice(2) : null,
      }),
    );
    return { message: "Custodian updated.", revalidate: [path(id)] };
  });
}

/** FR-PHO-005 / FR-PHO-007 */
export async function promotePhoto(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await promoteLatest(u, str(fd, "photo_id"));
    return { message: "Latest photo updated.", revalidate: [path(str(fd, "item_id"))] };
  });
}
export async function makeStock(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await setStockImage(u, str(fd, "photo_id"));
    return { message: "Stock image updated.", revalidate: [path(str(fd, "item_id"))] };
  });
}
export async function attachPhotos(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    const ids = list(fd, "photo_ids");
    if (str(fd, "kind") === "Latest" && ids.length) await promoteLatest(u, ids[ids.length - 1]);
    if (str(fd, "kind") === "Stock" && ids.length) await setStockImage(u, ids[ids.length - 1]);
    return { message: `${ids.length} photo(s) saved.`, revalidate: [path(id)] };
  });
}

/** FR-CHK-012 reservations */
export async function reserve(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "item_id");
    await withUser(u.id, (c) =>
      c.query(
        `insert into reservations(item_id, kit_id, person_id, shoot, starts_at, ends_at, created_by, note)
      values ($1,$2,$3,$4,$5,$6,auth.uid(),$7)`,
        [
          id || null,
          str(fd, "kit_id") || null,
          str(fd, "person_id") || u.personId,
          str(fd, "shoot"),
          fromIstInput(str(fd, "starts_at")),
          fromIstInput(str(fd, "ends_at")),
          str(fd, "note") || null,
        ],
      ),
    );
    return { message: "Reserved.", revalidate: [path(id), "/reservations"] };
  });
}
export async function cancelReservation(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) => c.query("update reservations set status = 'Cancelled' where id = $1", [str(fd, "id")]));
    return { revalidate: ["/reservations", path(str(fd, "item_id"))] };
  });
}
