import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { PageHeader, Section, Badge, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { run, addRule, disableRule } from "./actions";
import { fmtDateTime } from "@/lib/format";
export const metadata = { title: "Import review" };
/** SCR-13: results of the sheet import with warnings per row; Owner and Siddharth */
export default async function ImportPage() {
  const u = await requireUser();
  if (!(u.role === "Owner" || u.isDeveloper)) return <p>Owner and developer only.</p>;
  const d = await withUser(u.id, async (c) => ({
    runs: (await c.query("select * from import_runs order by started_at desc limit 30")).rows,
    rules: (await c.query("select * from import_mapping_rules where active order by created_at desc")).rows,
    imported: (await c.query("select count(*)::int n from items where imported")).rows[0]?.n ?? 0,
  }));
  const imported = d.imported as number;
  return (
    <>
      <PageHeader title="Import review" sub="Bring the Google Sheet / Excel inventory into the app. Preview as often as needed, then import." />
      <Section title="Run an import">
        <ActionForm action={run} className="grid gap-4">
          <label className="field">
            <span>Excel workbook (.xlsx) with the tabs Sheet1, To buy and Not yet sorted</span>
            <input
              type="file"
              name="workbook"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="input"
              data-testid="import-workbook"
            />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Or upload one file per tab (CSV or Excel)</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="field">
                <span>Sheet1 (items)</span>
                <input type="file" name="sheet1" accept=".csv,text/csv,.xlsx" className="input" />
              </label>
              <label className="field">
                <span>To buy</span>
                <input type="file" name="tobuy" accept=".csv,text/csv,.xlsx" className="input" />
              </label>
              <label className="field">
                <span>Not yet sorted</span>
                <input type="file" name="unsorted" accept=".csv,text/csv,.xlsx" className="input" />
              </label>
            </div>
          </details>
          {!env.isProductionEnv && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="source" value="fixture" /> Use the SYNTHETIC test fixture instead of an upload
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field">
              <span>Mode</span>
              <select name="mode" className="input" defaultValue="dry-run">
                <option value="dry-run">Preview (nothing is saved, report only)</option>
                {u.role === "Owner" && <option value="apply">Import into the inventory</option>}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="replace" />
              <span>Replace data from earlier imports{imported > 0 ? ` (${imported} imported items now)` : ""}</span>
            </label>
          </div>
          <p className="muted text-sm">
            Items go to Items, the To buy tab to To buy and Not yet sorted to Unsorted. Run a Preview first; the report lists every warning per row. Replace only removes what an
            earlier import created; it stops if those items already have loans or other records made in the app.
          </p>
          <div>
            <Submit>Run</Submit>
          </div>
        </ActionForm>
      </Section>
      <Section title="Runs">
        {d.runs.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Started</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Items</th>
                <th>Warnings</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {d.runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/import/${r.id}`}>{fmtDateTime(r.started_at)}</Link>
                  </td>
                  <td>{r.mode}</td>
                  <td>
                    <Badge v={r.status === "succeeded" ? "Approved" : "Rejected"} title={r.status} /> {r.status}
                  </td>
                  <td>{r.summary?.items ?? "—"}</td>
                  <td>{r.summary?.warnings ?? "—"}</td>
                  <td>
                    {r.summary?.errors ?? "—"}
                    {r.summary?.error ? ` — ${r.summary.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No runs yet.</Empty>
        )}
      </Section>
      <Section title="Mapping rules (decisions from the review, section 11.1 step 3)">
        <p className="muted mb-2 text-sm">
          Rules for the real sheet are in src/lib/importer/mapping-rules.json. Rules saved here override them. Examples: {'{"custodian": true}'} for an item held by its normal
          custodian (OQ-N-19); {'{"owner": "Anand", "owner_confirmed": true}'}; {'{"expand_ranges": true}'} on target &quot;To buy:2&quot;.
        </p>
        {d.rules.length > 0 && (
          <ul className="mb-3">
            {d.rules.map((r) => (
              <li key={r.id}>
                <code>{r.target}</code> {JSON.stringify(r.rule)} {r.note && `— ${r.note}`}
                <ActionForm action={disableRule} className="inline">
                  <input type="hidden" name="id" value={r.id} />
                  <Submit className="btn btn-sm btn-secondary ml-2">Remove</Submit>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addRule} className="grid gap-2 sm:grid-cols-4" resetOnSuccess>
          <input name="target" className="input" placeholder="MTMH_113 or To buy:2" required />
          <input name="rule" className="input sm:col-span-2" placeholder='{"custodian": true}' required />
          <input name="note" className="input" placeholder="Decided by / why" />
          <Submit>Save rule</Submit>
        </ActionForm>
      </Section>
    </>
  );
}
