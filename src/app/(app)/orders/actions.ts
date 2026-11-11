"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, num, list, type ActionState } from "@/lib/actions";
import { notify, managerEmails } from "@/lib/services/notifications";

/** FR-BUY-006: vendor, order number, date, amount, invoice/order PDF, expected delivery */
export async function createOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = await withUser(u.id, async (c) => {
      const o = await c.query(
        `insert into orders(vendor, order_ref, order_date, expected_delivery, notes, created_by) values ($1,$2,$3,nullif($4,'')::date,nullif($5,''),auth.uid()) returning id`,
        [str(fd, "vendor"), str(fd, "order_ref"), str(fd, "order_date"), str(fd, "expected_delivery"), str(fd, "notes")],
      );
      const oid = o.rows[0].id;
      if (u.financeVisible && str(fd, "amount")) await c.query("insert into order_financials(order_id, amount) values ($1,$2)", [oid, num(fd, "amount")]);
      const descs = list(fd, "line_description"),
        qtys = fd.getAll("line_qty").map(String),
        wls = fd.getAll("line_wishlist").map(String);
      for (let i = 0; i < descs.length; i++) {
        await c.query("insert into order_lines(order_id, wishlist_id, description, quantity) values ($1, nullif($2,'')::uuid, $3, $4)", [
          oid,
          wls[i] ?? "",
          descs[i],
          Number(qtys[i] || 1),
        ]);
        if (wls[i]) await c.query("update wishlist_items set status = 'Ordered' where id = $1 and status = 'Approved'", [wls[i]]);
      }
      return oid;
    });
    return { redirectTo: `/orders/${id}` };
  });
}
export async function cancelOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "order_id");
    await withUser(u.id, (c) => c.query("update orders set status = 'Cancelled', cancelled_reason = $2 where id = $1 and status = 'Placed'", [id, str(fd, "reason")]));
    return { revalidate: [`/orders/${id}`] };
  });
}
/** FR-BUY-007 / AC-BUY-03: receive and create items in one step */
export async function receive(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "order_id");
    const lineIds = list(fd, "line_id");
    const lines = lineIds
      .map((lid) => {
        const n = num(fd, `qty_${lid}`) ?? 0;
        const mode = str(fd, `mode_${lid}`) || "Single";
        const base = {
          name: str(fd, `name_${lid}`),
          type: str(fd, `type_${lid}`),
          model_number: str(fd, `model_${lid}`),
          brand: str(fd, `brand_${lid}`),
          quantity_mode: mode,
          purchase_price: u.financeVisible ? str(fd, `price_${lid}`) : "",
        };
        const items = mode === "Counted" ? [{ ...base, stock: n }] : Array.from({ length: n }, (_, i) => ({ ...base, name: n > 1 ? `${base.name} #${i + 1}` : base.name }));
        return { order_line_id: lid, quantity: n, items };
      })
      .filter((l) => l.quantity > 0);
    const r = await withUser(u.id, (c) =>
      callWorkflow<{ items_created: string[]; status: string }>(c, "receive_order", { order_id: id, lines, delivered_at: str(fd, "delivered_at") || null }),
    );
    // NTF-011: order delivered -> proposer and Anand
    const proposers = await withUser(u.id, async (c) =>
      (
        await c.query(
          `select distinct us.login_email from order_lines ol join wishlist_items w on w.id = ol.wishlist_id join users us on us.id = w.proposed_by where ol.order_id = $1`,
          [id],
        )
      ).rows.map((x) => x.login_email),
    );
    await notify({
      code: "NTF-011",
      dedupe: `NTF-011:delivered:${id}:${r.items_created.join(",")}`,
      to: [...proposers, ...(await managerEmails())],
      subject: `Order received: ${r.items_created.length} new item(s)`,
      text: `Received and created ${r.items_created.join(", ")}. Add a stock photo and print QR labels.`,
    });
    return { redirectTo: `/orders/${id}?received=${encodeURIComponent(r.items_created.join(","))}` };
  });
}
