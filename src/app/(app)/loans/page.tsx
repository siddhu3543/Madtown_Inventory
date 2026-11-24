import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listLoans } from "@/lib/services/loans";
import { withUser } from "@/lib/db";
import { PageHeader, Badge, Flag, Section } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { fmtDateTime } from "@/lib/format";
import { resolveConflict } from "./actions";

export const metadata = { title: "Loans" };

export default async function Loans({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  let rows = await listLoans(u, { status: sp.status ?? (sp.legacy || sp.item ? undefined : "open"), legacy: !!sp.legacy, project: sp.project, from: sp.from, to: sp.to });
  if (sp.item) rows = rows.filter((r) => r.items.split(", ").some((x: string) => x.startsWith(sp.item + " ")));
  if (sp.evidence === "incomplete") rows = rows.filter((r) => r.pending_evidence > 0);
  const conflicts =
    u.role === "Admin"
      ? await withUser(
          u.id,
          async (c) =>
            (
              await c.query(
                "select s.*, p.name as user_name from sync_conflicts s left join users us on us.id = s.user_id left join people p on p.id = us.person_id where s.resolved_at is null order by s.created_at desc",
              )
            ).rows,
        )
      : [];
  const tab = (k: string, label: string) => (
    <Link href={`/loans?${k}`} className="btn btn-sm btn-secondary">
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Loans"
        sub={`${rows.length} loan(s)`}
        actions={
          <>
            {tab("status=open", "Open")}
            {tab("status=Overdue", "Overdue")}
            {tab("legacy=1", "Legacy to confirm")}
            {tab("status=Returned", "Returned")}
            {tab("status=Lost", "Lost")}
            {tab("evidence=incomplete", "Incomplete evidence")}
          </>
        }
      />
      {conflicts.length > 0 && (
        <Section title="Offline actions rejected by the server (NFR-014)">
          <ul className="flex flex-col gap-2">
            {conflicts.map((c) => (
              <li key={c.id}>
                <b>{c.error_code}</b> {c.error} — {c.user_name}, queued {fmtDateTime(c.client_created_at)}{" "}
                <code className="text-xs">{JSON.stringify(c.action.payload ?? c.action).slice(0, 120)}</code>
                <ActionForm action={resolveConflict} className="inline">
                  <input type="hidden" name="id" value={c.id} />
                  <input name="note" className="input inline w-48" placeholder="resolution" />
                  <Submit className="btn btn-sm btn-secondary">Resolve</Submit>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <div className="overflow-x-auto card">
        <table className="tbl" data-testid="loans-table">
          <thead>
            <tr>
              <th>Items</th>
              <th>Borrower</th>
              <th>Out</th>
              <th>Due</th>
              <th>Status</th>
              <th>Reminders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/loans/${l.id}`} className="font-semibold">
                    {l.items}
                  </Link>
                </td>
                <td>{l.borrower_name}</td>
                <td>{l.checked_out_at ? fmtDateTime(l.checked_out_at) : "unknown"}</td>
                <td>{l.due_at ? fmtDateTime(l.due_at) : "—"}</td>
                <td>
                  <Badge v={l.status} /> {l.legacy && <Flag>legacy</Flag>} {l.pending_evidence > 0 && <Flag tone="bad">evidence incomplete</Flag>}
                </td>
                <td>{l.reminder_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
