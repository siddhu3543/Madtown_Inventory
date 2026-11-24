import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PageHeader, Badge } from "@/components/ui";
import { CheckoutForm } from "@/components/CheckoutForm";
import { borrowerContactStatus } from "@/lib/services/loans";
import { toIstInput } from "@/lib/format";
import { doCheckout } from "./actions";

export const metadata = { title: "Check out" };

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const id = decodeURIComponent((await params).id).toUpperCase();
  if (!can.checkoutSelf(u)) return <p>Your role cannot check items out.</p>;
  const data = await withUser(u.id, async (c) => {
    const it = (
      await c.query("select v.*, t.default_loan_days, t.checkout_photo_required, t.loan_days_confirmed from items_v v join item_types t on t.name = v.type where v.id = $1", [id])
    ).rows[0];
    const od = (await c.query("select borrower_person_id, count(*)::int n from loans where status = 'Overdue' group by 1")).rows;
    return { it, overdue: Object.fromEntries(od.map((r) => [r.borrower_person_id, r.n])) };
  });
  if (!data.it) notFound();
  const lk = await lookups(u);
  const it = data.it;
  const due = new Date(Date.now() + (it.default_loan_days ?? 7) * 86400_000);
  const people = lk.people.filter((p) => !p.is_madtown && p.active).sort((a, b) => (a.id === u.personId ? -1 : b.id === u.personId ? 1 : a.name.localeCompare(b.name)));
  const contactStatus = await borrowerContactStatus(
    u,
    people.map((x) => x.id),
  );
  return (
    <>
      <PageHeader
        title={`Check out ${it.id}`}
        sub={
          <>
            {it.name} · <Badge v={it.display_status} /> {it.quantity_mode === "Counted" && `· ${it.available_qty} of ${it.stock} available`}
          </>
        }
        actions={
          <Link href={`/items/${it.id}`} className="btn btn-secondary">
            Back
          </Link>
        }
      />
      {!it.loan_days_confirmed && (
        <p className="muted mb-2 text-sm">
          Default loan period for {it.type}: {it.default_loan_days} days (proposal; an Admin confirms it in Settings).
        </p>
      )}
      <div className="card p-4">
        <CheckoutForm
          action={doCheckout}
          target={{
            item_id: it.id,
            label: `${it.id} ${it.name}`,
            counted: it.quantity_mode === "Counted",
            available: it.available_qty,
            photoRequired: it.checkout_photo_required,
            photoItems: [{ id: it.id, type: it.type }],
          }}
          people={people}
          me={u.personId}
          canOthers={can.checkoutOthers(u)}
          canOverride={can.override(u)}
          conditions={lk.conditions.map((c) => c.name)}
          defaultCondition={it.condition}
          defaultDue={toIstInput(due)}
          locations={lk.locations}
          contactStatus={contactStatus}
          borrowerOverdue={data.overdue}
        />
      </div>
    </>
  );
}
