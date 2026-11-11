"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, bool, num, type ActionState } from "@/lib/actions";
import { notify, ownerEmails } from "@/lib/services/notifications";

const ids = (s: string) =>
  s
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? `MTMH_${x}` : x.toUpperCase()));

/** FR-BUY-001/005: Managers (and Team members, to confirm) propose; Owner decides. NTF-010 to Naveen immediately. */
export async function propose(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = await withUser(u.id, async (c) => {
      const r = await c.query(
        `insert into wishlist_items(item_description, reason, replaces_or_adds, replaces_or_adds_note, priority, status, verify_first, verify_note, links, notes)
        values ($1,$2,$3,nullif($4,''),$5,$6,$7,nullif($8,''),nullif($9,''),nullif($10,'')) returning id`,
        [
          str(fd, "item_description"),
          str(fd, "reason"),
          str(fd, "replaces_or_adds"),
          str(fd, "replaces_or_adds_note"),
          str(fd, "priority"),
          str(fd, "status") || "To buy",
          bool(fd, "verify_first"),
          str(fd, "verify_note"),
          str(fd, "links"),
          str(fd, "notes"),
        ],
      );
      for (const it of ids(str(fd, "related"))) await c.query("insert into wishlist_related_items(wishlist_id, item_id) values ($1,$2) on conflict do nothing", [r.rows[0].id, it]);
      if (u.financeVisible && str(fd, "estimated_cost"))
        await c.query("insert into wishlist_financials(wishlist_id, estimated_cost) values ($1,$2)", [r.rows[0].id, num(fd, "estimated_cost")]);
      return r.rows[0].id as string;
    });
    await notify({
      code: "NTF-010",
      dedupe: `NTF-010:${id}`,
      to: await ownerEmails(),
      subject: `To-buy waiting for approval: ${str(fd, "item_description")}`,
      text: `${u.name} proposed "${str(fd, "item_description")}" (${str(fd, "priority")}). Reason: ${str(fd, "reason")}`,
    });
    return { redirectTo: `/to-buy/${id}` };
  });
}
export async function decide(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "wishlist_id");
    await withUser(u.id, (c) => callWorkflow(c, "decide_wishlist", { wishlist_id: id, approve: str(fd, "d") === "approve", comment: str(fd, "comment") }));
    return { revalidate: [`/to-buy/${id}`, "/to-buy"] };
  });
}
export async function verify(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "wishlist_id");
    await withUser(u.id, (c) => callWorkflow(c, "verify_wishlist", { wishlist_id: id, result: str(fd, "result") }));
    return { revalidate: [`/to-buy/${id}`] };
  });
}
export async function setStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "wishlist_id");
    await withUser(u.id, (c) => c.query("update wishlist_items set status = $2 where id = $1", [id, str(fd, "status")]));
    return { revalidate: [`/to-buy/${id}`] };
  });
}
export async function addOption(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "wishlist_id");
    await withUser(u.id, (c) =>
      c.query("insert into wishlist_options(wishlist_id, vendor, price, stock_note, link, created_by) values ($1,$2,$3,nullif($4,''),nullif($5,''),auth.uid())", [
        id,
        str(fd, "vendor"),
        num(fd, "price"),
        str(fd, "stock_note"),
        str(fd, "link"),
      ]),
    );
    return { revalidate: [`/to-buy/${id}`] };
  });
}
export async function linkItems(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "wishlist_id");
    await withUser(u.id, async (c) => {
      for (const it of ids(str(fd, "related"))) await c.query("insert into wishlist_related_items(wishlist_id, item_id) values ($1,$2) on conflict do nothing", [id, it]);
    });
    return { revalidate: [`/to-buy/${id}`] };
  });
}
