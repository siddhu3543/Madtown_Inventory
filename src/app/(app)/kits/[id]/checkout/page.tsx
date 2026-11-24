import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { lookups } from "@/lib/services/items";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { CheckoutForm } from "@/components/CheckoutForm";
import { borrowerContactStatus } from "@/lib/services/loans";
import { toIstInput } from "@/lib/format";
import { kitCheckout } from "../../actions";
export const metadata = { title: "Check out kit" };
/** FR-KIT-004: a kit checks out as one unit */
export default async function KitCheckout({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const id = decodeURIComponent((await params).id).toUpperCase();
  const d = await withUser(u.id, async (c) => ({
    kit: (await c.query("select * from kits where id = $1", [id])).rows[0],
    parts: (
      await c.query(
        "select ki.item_id, v.type, t.checkout_photo_required, t.default_loan_days from kit_items ki join items_v v on v.id = ki.item_id join item_types t on t.name = v.type where ki.kit_id = $1",
        [id],
      )
    ).rows,
    od: Object.fromEntries(
      (await c.query("select borrower_person_id, count(*)::int n from loans where status = 'Overdue' group by 1")).rows.map((r) => [r.borrower_person_id, r.n]),
    ),
  }));
  if (!d.kit) notFound();
  const lk = await lookups(u);
  const days = Math.min(...d.parts.map((p) => p.default_loan_days ?? 7), 7);
  const people = lk.people.filter((p) => !p.is_madtown && p.active).sort((a, b) => (a.id === u.personId ? -1 : b.id === u.personId ? 1 : a.name.localeCompare(b.name)));
  const contactStatus = await borrowerContactStatus(
    u,
    people.map((x) => x.id),
  );
  return (
    <>
      <PageHeader title={`Check out ${d.kit.id} ${d.kit.name}`} phase={2} />
      <div className="card p-4">
        <CheckoutForm
          action={kitCheckout}
          target={{
            kit_id: id,
            label: `${id} ${d.kit.name}`,
            counted: false,
            available: 1,
            photoRequired: true,
            photoItems: d.parts.filter((p) => p.checkout_photo_required).map((p) => ({ id: p.item_id, type: p.type })),
          }}
          people={people}
          me={u.personId}
          canOthers={can.checkoutOthers(u)}
          canOverride={can.override(u)}
          conditions={lk.conditions.map((c) => c.name)}
          defaultCondition="Good"
          defaultDue={toIstInput(new Date(Date.now() + days * 86400000))}
          locations={lk.locations}
          contactStatus={contactStatus}
          borrowerOverdue={d.od}
        />
      </div>
    </>
  );
}
