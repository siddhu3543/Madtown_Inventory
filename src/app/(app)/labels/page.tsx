import { requireUser } from "@/lib/auth";
import { listItems } from "@/lib/services/items";
import { withUser } from "@/lib/db";
import { qrSvg, qrUrl, parseIdList } from "@/lib/qr";
import { PrintButton } from "@/components/PrintButton";
import { PageHeader } from "@/components/ui";
export const metadata = { title: "Print labels" };

/** SCR-11 / FR-QR-004: printable QR label sheet with ID and name, 25 mm × 25 mm labels; FR-QR-005 pouch/case labels. */
export default async function Labels({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser(["Owner", "Manager"]);
  const sp = await searchParams;
  const ids = sp.ids ? parseIdList(sp.ids) : [];
  const kitIds = sp.kits
    ? sp.kits
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((x) => x.toUpperCase())
    : [];
  const fromFilter = !sp.ids && !sp.kits && (sp.q || sp.view || sp.type || sp.new);
  let items = ids.length ? await listItems(u, { ids, includeRetired: true }) : fromFilter ? await listItems(u, { q: sp.q, view: sp.view, type: sp.type }) : [];
  if (sp.new)
    items = (await withUser(u.id, async (c) => (await c.query("select id from items where created_at > now() - interval '14 days' and not imported")).rows)).length
      ? await listItems(u, {
          ids: (await withUser(u.id, async (c) => (await c.query("select id from items where created_at > now() - interval '14 days' and not imported")).rows)).map((r) => r.id),
        })
      : [];
  const kits = kitIds.length ? await withUser(u.id, async (c) => (await c.query("select id, name from kits where id = any($1)", [kitIds])).rows) : [];
  const labels = [
    ...(await Promise.all(
      items.map(async (i) => ({
        id: i.id,
        name: i.name,
        sub: i.label_target !== "Item" ? `Label on ${i.label_target.toLowerCase()}${i.label_note ? `: ${i.label_note}` : ""}` : "",
        svg: await qrSvg(qrUrl("item", i.id)),
      })),
    )),
    ...(await Promise.all(kits.map(async (k) => ({ id: k.id, name: k.name, sub: "Kit", svg: await qrSvg(qrUrl("kit", k.id)) })))),
  ];
  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Print labels"
          sub="25 mm × 25 mm durable labels. Each QR opens the item page."
          actions={labels.length ? <PrintButton label={`Print ${labels.length} label(s)`} /> : null}
        />
        <form className="card mb-4 grid gap-2 p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
          <input name="ids" className="input" placeholder="Item IDs, e.g. 101-110, 115" defaultValue={sp.ids ?? ""} data-testid="label-ids" />
          <input name="kits" className="input" placeholder="Kit IDs, e.g. KIT_001" defaultValue={sp.kits ?? ""} />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="new" value="1" defaultChecked={!!sp.new} /> New items (14 days)
          </label>
          <button className="btn btn-primary">Preview</button>
        </form>
      </div>
      <style>{`@page { size: A4; margin: 8mm; } .lbl { width: 25mm; height: 25mm; } .lbl svg { width: 15mm; height: 15mm; }`}</style>
      <div className="flex flex-wrap gap-[2mm] bg-white p-[2mm]" data-testid="label-sheet">
        {labels.map((l) => (
          <div
            key={l.id}
            className="lbl flex flex-col items-center justify-start overflow-hidden border border-dashed border-gray-400 p-[0.8mm] text-center text-black"
            data-testid="label"
          >
            <div dangerouslySetInnerHTML={{ __html: l.svg }} />
            <div className="text-[2.6mm] font-bold leading-none" data-testid="label-id">
              {l.id}
            </div>
            <div className="text-[1.9mm] leading-tight line-clamp-2">{l.name}</div>
            {l.sub && <div className="text-[1.6mm] leading-none">{l.sub}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
