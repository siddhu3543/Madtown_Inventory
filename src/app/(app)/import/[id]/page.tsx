import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { PageHeader, Section, Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
export const metadata = { title: "Import report" };
export default async function Run({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ level?: string; code?: string }> }) {
  const u = await requireUser();
  if (!(u.role === "Owner" || u.isDeveloper)) return <p>Owner and developer only.</p>;
  const { id } = await params;
  const sp = await searchParams;
  const d = await withUser(u.id, async (c) => ({
    run: (await c.query("select * from import_runs where id = $1", [id])).rows[0],
    codes: (await c.query("select level, code, count(*)::int n from import_row_results where run_id = $1 group by 1,2 order by 1,3 desc", [id])).rows,
    rows: (
      await c.query(
        "select * from import_row_results where run_id = $1 and ($2::text is null or level = $2) and ($3::text is null or code = $3) order by tab, sheet_row nulls first, id",
        [id, sp.level ?? null, sp.code ?? null],
      )
    ).rows,
  }));
  if (!d.run) return <p>Not found</p>;
  return (
    <>
      <PageHeader title={`Import ${d.run.mode} — ${d.run.status}`} sub={`${fmtDateTime(d.run.started_at)} · ${d.run.source_description ?? ""} · ${d.run.environment}`} />
      {d.run.summary?.error && (
        <p role="alert" className="mb-3 font-semibold text-[var(--color-bad)]">
          {d.run.summary.error}
        </p>
      )}
      <Section title="Summary">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="import-summary">
          {Object.entries(d.run.summary ?? {})
            .filter(([k]) => k !== "error")
            .map(([k, v]) => (
              <div key={k} className="card p-2">
                <div className="text-xl font-bold">{String(v)}</div>
                <div className="muted text-sm">{k.replace(/_/g, " ")}</div>
              </div>
            ))}
        </div>
      </Section>
      <Section title="Warnings by type">
        <div className="flex flex-wrap gap-2">
          {d.codes.map((c) => (
            <Link key={c.level + c.code} href={`?level=${c.level}&code=${c.code}`} className="btn btn-sm btn-secondary">
              {c.level} {c.code} ({c.n})
            </Link>
          ))}
          <Link href="?" className="btn btn-sm btn-secondary">
            All
          </Link>
        </div>
      </Section>
      <Section title={`Rows (${d.rows.length})`}>
        <div className="overflow-x-auto">
          <table className="tbl text-sm" data-testid="import-rows">
            <thead>
              <tr>
                <th>Tab</th>
                <th>Row</th>
                <th>Record</th>
                <th>Level</th>
                <th>Code</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.tab}</td>
                  <td>{r.sheet_row}</td>
                  <td>{r.record_ref?.startsWith("MTMH_") ? <Link href={`/items/${r.record_ref}`}>{r.record_ref}</Link> : r.record_ref}</td>
                  <td>
                    <Badge v={r.level === "error" ? "Lost" : r.level === "warning" ? "In repair" : "Available"} title={r.level} /> {r.level}
                  </td>
                  <td>{r.code}</td>
                  <td>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
