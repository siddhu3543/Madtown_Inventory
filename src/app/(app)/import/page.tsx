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
  }));
  return (
    <>
      <PageHeader title="Import review" sub="Migration of the sheet (section 11). Dry-run as often as needed; the production import runs once." />
      <Section title="Run an import">
        <ActionForm action={run} className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Sheet1.csv</span>
            <input type="file" name="sheet1" accept=".csv,text/csv" className="input" />
          </label>
          <label className="field">
            <span>To buy.csv</span>
            <input type="file" name="tobuy" accept=".csv,text/csv" className="input" />
          </label>
          <label className="field">
            <span>Not yet sorted.csv</span>
            <input type="file" name="unsorted" accept=".csv,text/csv" className="input" />
          </label>
          {!env.isProductionEnv && (
            <label className="flex items-center gap-2">
              <input type="radio" name="source" value="fixture" /> Use the SYNTHETIC fixture instead of uploads
            </label>
          )}
          <label className="field">
            <span>Mode</span>
            <select name="mode" className="input">
              <option value="dry-run">Dry-run (nothing saved, report only)</option>
              {u.role === "Owner" && !env.isProductionEnv && <option value="apply">Apply to staging (empty catalog only)</option>}
              {u.role === "Owner" && env.isProductionEnv && <option value="final">FINAL production import (once)</option>}
            </select>
          </label>
          <Submit>Run</Submit>
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
          Proposed rules from the spec are in fixtures/mapping-rules.json. Rules saved here override them. Examples: {'{"custodian": true}'} for an item held by its normal
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
