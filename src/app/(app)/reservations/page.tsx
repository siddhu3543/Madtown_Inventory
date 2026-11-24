import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { PageHeader, Empty, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { cancelReservation, reserve } from "../items/[id]/actions";
import { fmtDate, fmtDateTime, toIstInput } from "@/lib/format";
import { lookups } from "@/lib/services/items";
export const metadata = { title: "Reservations" };
/** SCR-23 reservations calendar (Phase 2; Google Calendar sync is Phase 3) */
export default async function Reservations() {
  const u = await requireUser(["Admin"]);
  const [rows, lk] = await Promise.all([
    withUser(
      u.id,
      async (c) =>
        (
          await c.query(`select r.*, p.name person, coalesce(i.name, k.name) target_name from reservations r join people p on p.id = r.person_id
      left join items i on i.id = r.item_id left join kits k on k.id = r.kit_id where r.status = 'Active' and r.ends_at > now() - interval '1 day' order by r.starts_at`)
        ).rows,
    ),
    lookups(u),
  ]);
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = fmtDate(r.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  return (
    <>
      <PageHeader title="Reservations" phase={2} sub="Bookings per item and shoot, so two people do not plan the same item. Google Calendar sync: Phase 3 (roadmap)." />
      {rows.length === 0 ? (
        <Empty>No upcoming reservations.</Empty>
      ) : (
        [...byDay.entries()].map(([day, rs]) => (
          <section key={day} className="card mb-3 p-3">
            <h2 className="font-bold">{day}</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {rs.map((r) => (
                <li key={r.id}>
                  <b>{r.shoot}</b> ·{" "}
                  <Link href={r.item_id ? `/items/${r.item_id}` : `/kits/${r.kit_id}`}>
                    {r.item_id ?? r.kit_id} {r.target_name}
                  </Link>{" "}
                  · {r.person} · {fmtDateTime(r.starts_at)} → {fmtDateTime(r.ends_at)} <Badge v={r.status} />
                  <Link href={`/reports/pick-list?shoot=${encodeURIComponent(r.shoot)}`} className="ml-2">
                    pick list
                  </Link>
                  {(u.role === "Admin" || r.created_by === u.id) && (
                    <ActionForm action={cancelReservation} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="item_id" value={r.item_id ?? ""} />
                      <Submit className="btn btn-sm btn-secondary ml-2">Cancel</Submit>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {u.role === "Admin" && (
        <div className="card mt-4 p-4">
          <h2 className="mb-2 font-bold">Reserve a kit</h2>
          <ActionForm action={reserve} className="grid gap-2 sm:grid-cols-3" resetOnSuccess>
            <input type="hidden" name="item_id" value="" />
            <input name="kit_id" className="input" placeholder="KIT_001" required />
            <input name="shoot" className="input" placeholder="Shoot" required />
            {u.role === "Admin" ? (
              <select name="person_id" className="input">
                {lk.people
                  .filter((p) => !p.is_madtown)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            ) : (
              <span />
            )}
            <input name="starts_at" type="datetime-local" className="input" defaultValue={toIstInput(new Date(Date.now() + 86400000))} required />
            <input name="ends_at" type="datetime-local" className="input" defaultValue={toIstInput(new Date(Date.now() + 2 * 86400000))} required />
            <Submit>Reserve</Submit>
          </ActionForm>
        </div>
      )}
    </>
  );
}
