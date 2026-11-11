import { requireUser } from "@/lib/auth";
import { lookups, listItems } from "@/lib/services/items";
import { PageHeader } from "@/components/ui";
import { ItemForm } from "@/components/ItemForm";
import { create } from "./actions";
export const metadata = { title: "Add item" };
export default async function NewItem() {
  const u = await requireUser(["Owner", "Manager"]);
  const [lk, items] = await Promise.all([lookups(u), listItems(u, {})]);
  return (
    <>
      <PageHeader title="Add item" sub="A new item gets the next free MTMH ID automatically." />
      <div className="card p-4">
        <ItemForm action={create} lk={lk} finance={u.financeVisible} isNew parents={items.map((i) => ({ id: i.id, name: i.name }))} />
      </div>
    </>
  );
}
