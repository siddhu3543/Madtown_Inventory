import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { loansReport, repairsReport, utilisation, assetValue, tco, shoots } from "@/lib/services/reports";
import { PageHeader, Section, ItemLink, Phase, Empty, Tabs } from "@/components/ui";
import { fmtRs, fmtDate } from "@/lib/format";
export const metadata = { title: "Reports" };

/** SCR-20 / FR-RPT-002..007, FR-CON-009. Team members get limited reports without cost (section 9). */
export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "inventory";
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
    to = sp.to ?? today;
  const tabs: [string, string, (1 | 2 | 3)?, boolean?][] = [
    ["inventory", "Inventory"],
    ["loans", "Loans", 2],
    ["repairs", "Repairs", 2],
    ["utilisation", "Utilisation", 2],
    ["pick", "Shoot pick list", 2],
    ["asset", "Asset value", 3, true],
    ["tco", "Cost of ownership", 3, true],
  ];
  let body: React.ReactNode = null;
  if (tab === "inventory") {
    const groups = await withUser(u.id, async (c) => {
      const g = async (col: string) => (await c.query(`select coalesce(${col}, '(blank)') k, count(*)::int n from items_v where is_active group by 1 order by 2 desc`)).rows;
      return { Type: await g("type"), Status: await g("display_status"), Condition: await g("condition"), Holder: await g("holder_label"), Owner: await g("owner_name") };
    });
    body = (
      <>
        <p className="mb-3">
          <a href="/api/export/inventory.csv" className="btn btn-primary" data-testid="inventory-csv">
            Download inventory CSV (all active items)
          </a>{" "}
          <Link href="/items" className="btn btn-secondary">
            Filter in Items, then export
          </Link>
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(groups).map(([k, rows]) => (
            <Section key={k} title={`By ${k}`}>
              <table className="tbl">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.k}>
                      <td>{r.k}</td>
                      <td className="text-right">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))}
        </div>
      </>
    );
  } else if (tab === "loans") {
    const r = await loansReport(u, from, to);
    body = (
      <>
        <form className="mb-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="loans" />
          <label className="field">
            <span>From</span>
            <input type="date" name="from" defaultValue={from} className="input" />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" name="to" defaultValue={to} className="input" />
          </label>
          <button className="btn btn-primary">Run</button>
          <a href={`/api/export/loans.csv?from=${from}&to=${to}`} className="btn btn-secondary">
            CSV
          </a>
        </form>
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Section title="By person">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Loans</th>
                  <th>Units</th>
                  <th>Overdue</th>
                  <th>Damaged</th>
                </tr>
              </thead>
              <tbody>
                {r.byPerson.map((x) => (
                  <tr key={x.name}>
                    <td>{x.name}</td>
                    <td>{x.loans}</td>
                    <td>{x.units}</td>
                    <td>{x.overdue}</td>
                    <td>{x.damaged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="By project or shoot">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Loans</th>
                  <th>Units</th>
                  <th>People</th>
                </tr>
              </thead>
              <tbody>
                {r.byProject.map((x) => (
                  <tr key={x.project}>
                    <td>{x.project}</td>
                    <td>{x.loans}</td>
                    <td>{x.units}</td>
                    <td>{x.people}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </>
    );
  } else if (tab === "repairs") {
    const r = await repairsReport(u);
    body = (
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Per item">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th>Events</th>
                <th>Repairs</th>
                {r.costs && <th>Cost</th>}
              </tr>
            </thead>
            <tbody>
              {r.byItem.map((x) => (
                <tr key={x.item_id}>
                  <td>
                    <ItemLink id={x.item_id} name={x.name} />
                  </td>
                  <td>{x.events}</td>
                  <td>{x.repairs}</td>
                  {r.costs && <td>{fmtRs(x.cost)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Per vendor">
          <table className="tbl">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Events</th>
                {r.costs && <th>Cost</th>}
              </tr>
            </thead>
            <tbody>
              {r.byVendor.map((x) => (
                <tr key={x.vendor}>
                  <td>{x.vendor}</td>
                  <td>{x.events}</td>
                  {r.costs && <td>{fmtRs(x.cost)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    );
  } else if (tab === "utilisation") {
    const r = await utilisation(u);
    body = (
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title="Days out in the last 90 days">
          <table className="tbl">
            <tbody>
              {r.rows
                .filter((x) => x.days_out > 0)
                .map((x) => (
                  <tr key={x.id}>
                    <td>
                      <ItemLink id={x.id} name={x.name} />
                    </td>
                    <td className="text-right">{x.days_out}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Section>
        <Section title={`Never used (${r.neverUsed.length})`}>
          <ul className="text-sm">
            {r.neverUsed.map((x) => (
              <li key={x.id}>
                <ItemLink id={x.id} name={x.name} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    );
  } else if (tab === "pick") {
    const list = await shoots(u);
    const { pickList } = await import("@/lib/services/reports");
    body = (
      <>
        <form className="mb-3 flex gap-2">
          <input type="hidden" name="tab" value="pick" />
          <select name="shoot" className="input" defaultValue={sp.shoot}>
            {list.map((s) => (
              <option key={s.shoot}>{s.shoot}</option>
            ))}
          </select>
          <button className="btn btn-primary">Show</button>
        </form>
        {sp.shoot ? (
          <Link href={`/reports/pick-list?shoot=${encodeURIComponent(sp.shoot)}`} className="btn btn-secondary">
            Open printable pick list
          </Link>
        ) : (
          <Empty>Choose a shoot with reservations.</Empty>
        )}
        {sp.shoot && <p className="mt-2 muted">{(await pickList(u, sp.shoot)).length} line(s)</p>}
      </>
    );
  } else if (tab === "asset") {
    if (!u.financeVisible) body = <p>Asset value is restricted.</p>;
    else {
      const r = await assetValue(u);
      body = (
        <>
          <p className="mb-3 text-lg">
            Madtown-owned, active, not lost: <b data-testid="asset-total">{fmtRs(r.total)}</b> across {r.items.length} items ({r.unpriced} without a price). Missing (at risk):{" "}
            {fmtRs(r.atRiskTotal)}. <a href="/api/export/asset-value.csv">CSV</a>
          </p>
          <p className="muted mb-3">
            Excluded: {r.excludedPersonal.length} personally owned ({r.excludedPersonal.map((x) => x.id).join(", ")}), {r.excludedLost.length} lost. Depreciation: {r.depreciation}.
          </p>
          <table className="tbl">
            <tbody>
              {r.items
                .filter((x) => x.purchase_price)
                .map((x) => (
                  <tr key={x.id}>
                    <td>
                      <ItemLink id={x.id} name={x.name} />
                    </td>
                    <td>{fmtDate(x.purchase_date)}</td>
                    <td className="text-right">{fmtRs(x.purchase_price)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      );
    }
  } else if (tab === "tco") {
    if (!u.financeVisible) body = <p>Costs are restricted.</p>;
    else {
      const r = await tco(u);
      body = (
        <table className="tbl">
          <thead>
            <tr>
              <th>Item</th>
              <th>Purchase</th>
              <th>Repairs</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {r.map((x) => (
              <tr key={x.id}>
                <td>
                  <ItemLink id={x.id} name={x.name} />
                </td>
                <td>{fmtRs(x.purchase_price)}</td>
                <td>{fmtRs(x.repairs)}</td>
                <td>{fmtRs(x.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
  }
  return (
    <>
      <PageHeader title="Reports" />
      <Tabs
        active={tab}
        tabs={tabs
          .filter(([, , , fin]) => !fin || u.financeVisible)
          .map(([k, l, p]) => ({
            key: k,
            href: `/reports?tab=${k}`,
            label: (
              <>
                {l} {p && p > 1 && <Phase n={p} />}
              </>
            ),
          }))}
      />
      {body}
    </>
  );
}
