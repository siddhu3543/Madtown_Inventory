import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createKit } from "./actions";
export const metadata = { title: "Kits" };
/** SCR-14 kit list (Phase 2) */
export default async function Kits() {
  const u = await requireUser();
  const kits = await withUser(
    u.id,
    async (c) =>
      (
        await c.query(`select k.*, count(ki.item_id)::int parts, count(*) filter (where ki.required)::int required,
     (select count(*) from loans l where l.kit_id = k.id and l.status in ('Open','Overdue'))::int out from kits k left join kit_items ki on ki.kit_id = k.id group by k.id order by k.id`)
      ).rows,
  );
  return (
    <>
      <PageHeader title="Kits" phase={2} sub="Named bundles checked out together, with a contents checklist. Each part keeps its own ID." />
      {kits.length ? (
        <ul className="flex flex-col gap-2">
          {kits.map((k) => (
            <li key={k.id} className="card p-3">
              <Link href={`/kits/${k.id}`} className="text-lg font-bold">
                {k.id} · {k.name}
              </Link>
              <div className="muted">
                {k.parts} parts ({k.required} required){k.out ? " · checked out" : ""}
                {!k.active ? " · inactive" : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No kits yet. Which bundles exist is open question OQ-N-04.</Empty>
      )}
      {can.editItems(u) && (
        <div className="card mt-4 p-4">
          <h2 className="mb-2 font-bold">New kit</h2>
          <ActionForm action={createKit} className="grid gap-2 sm:grid-cols-3">
            <input name="name" className="input" placeholder="e.g. DJI RS4 Pro gimbal set" required />
            <input name="description" className="input" placeholder="Description" />
            <Submit>Create kit</Submit>
          </ActionForm>
        </div>
      )}
    </>
  );
}
