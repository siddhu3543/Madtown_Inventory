import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { lookups, listItems } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ItemForm } from "@/components/ItemForm";
import { update } from "../../new/actions";
export const metadata = { title: "Edit item" };
export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser(["Admin"]);
  const id = decodeURIComponent((await params).id).toUpperCase();
  const d = await withUser(u.id, async (c) => ({
    item: (await c.query("select * from items_v where id = $1", [id])).rows[0],
    fin: u.financeVisible ? ((await c.query("select * from item_financials where item_id = $1", [id])).rows[0] ?? null) : null,
  }));
  if (!d.item) notFound();
  const [lk, items] = await Promise.all([lookups(u), listItems(u, {})]);
  return (
    <>
      <PageHeader title={`Edit ${id}`} sub="The ID never changes." />
      <div className="card p-4">
        <ItemForm
          action={update}
          lk={lk}
          item={d.item}
          fin={d.fin}
          finance={u.financeVisible}
          isNew={false}
          parents={items.filter((i) => i.id !== id).map((i) => ({ id: i.id, name: i.name }))}
        />
      </div>
    </>
  );
}
