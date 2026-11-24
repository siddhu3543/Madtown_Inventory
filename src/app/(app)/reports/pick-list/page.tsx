import { requireUser } from "@/lib/auth";
import { pickList } from "@/lib/services/reports";
import { fmtDateTime } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
export const metadata = { title: "Pick list" };
/** FR-RPT-007 printable pick list */
export default async function PickList({ searchParams }: { searchParams: Promise<{ shoot?: string }> }) {
  const u = await requireUser(["Admin"]);
  const shoot = (await searchParams).shoot ?? "";
  const rows = await pickList(u, shoot);
  return (
    <div className="card p-6">
      <h1 className="text-2xl font-bold">Pick list: {shoot}</h1>
      {rows[0] && (
        <p className="muted">
          {fmtDateTime(rows[0].starts_at)} → {fmtDateTime(rows[0].ends_at)}
        </p>
      )}
      <div className="my-3">
        <PrintButton />
      </div>
      <table className="tbl mt-2">
        <thead>
          <tr>
            <th>☐</th>
            <th>Item</th>
            <th>Kit</th>
            <th>Qty</th>
            <th>Reserved for</th>
            <th>Status now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>☐</td>
              <td>
                {r.item_id} {r.name}
                {r.kit_id && !r.required ? " (optional)" : ""}
              </td>
              <td>{r.kit_id ? `${r.kit_id} ${r.kit_name}` : ""}</td>
              <td>{r.quantity ?? 1}</td>
              <td>{r.person}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
