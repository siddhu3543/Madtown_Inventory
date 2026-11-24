import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
export const metadata = { title: "Audit log" };
/** SCR-12 / FR-AUD-002: filtered global change history with CSV export; Owner only. Append-only (nobody can edit it). */
export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser(["Admin"]);
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0));
  const rows = await withUser(
    u.id,
    async (c) =>
      (
        await c.query(
          `select * from audit_log where ($1::text is null or item_id = $1 or record_id = $1) and ($2::text is null or table_name = $2) and ($3::text is null or source = $3)
       and ($4::date is null or at >= $4::date) and ($5::date is null or at < $5::date + 1) and ($6::text is null or actor_label ilike '%' || $6 || '%' or action ilike '%' || $6 || '%')
     order by id desc limit 200 offset $7`,
          [sp.record?.toUpperCase() || null, sp.table || null, sp.source || null, sp.from || null, sp.to || null, sp.q || null, page * 200],
        )
      ).rows,
  );
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  return (
    <>
      <PageHeader
        title="Audit log"
        sub="Every create, update, delete, check-out, check-in, import and sync. Append-only."
        actions={
          <a className="btn btn-secondary" href={`/api/export/audit-log.csv?${qs}`} data-testid="audit-csv">
            Export CSV
          </a>
        }
      />
      <form className="card mb-3 grid gap-2 p-3 sm:grid-cols-7">
        <input name="record" className="input" placeholder="Item / record ID" defaultValue={sp.record} />
        <input name="table" className="input" placeholder="Table (items, loans…)" defaultValue={sp.table} />
        <select name="source" className="input" defaultValue={sp.source ?? ""}>
          <option value="">Any source</option>
          <option>App</option>
          <option>Import</option>
          <option>Sync</option>
          <option>Job</option>
        </select>
        <input name="from" type="date" className="input" defaultValue={sp.from} />
        <input name="to" type="date" className="input" defaultValue={sp.to} />
        <input name="q" className="input" placeholder="Who / action" defaultValue={sp.q} />
        <button className="btn btn-primary">Filter</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="tbl text-sm" data-testid="audit-table">
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Record</th>
              <th>Before → After</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td className="whitespace-nowrap">{fmtDateTime(a.at)}</td>
                <td>{a.actor_label}</td>
                <td>
                  {a.action} <span className="muted">{a.table_name}</span>
                </td>
                <td>{a.item_id ?? a.record_id}</td>
                <td>
                  <code className="break-all text-xs">
                    {a.before_json ? JSON.stringify(a.before_json).slice(0, 200) : "∅"} → {a.after_json ? JSON.stringify(a.after_json).slice(0, 200) : "∅"}
                  </code>
                  {a.reason && <div>Reason: {a.reason}</div>}
                </td>
                <td>{a.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        {page > 0 && (
          <a className="btn btn-secondary" href={`?${qs}&page=${page - 1}`}>
            Newer
          </a>
        )}
        {rows.length === 200 && (
          <a className="btn btn-secondary" href={`?${qs}&page=${page + 1}`}>
            Older
          </a>
        )}
      </div>
    </>
  );
}
