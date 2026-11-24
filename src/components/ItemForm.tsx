import type { Lookups } from "@/lib/services/items";
import Link from "next/link";
import { ActionForm, Submit } from "./ActionForm";
import { FormSection } from "./ui";
import type { ActionState } from "@/lib/actions";

type Item = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** SCR-06: all item fields with validation; To verify flag; Admins only. */
export function ItemForm({
  action,
  lk,
  item,
  fin,
  finance,
  isNew,
  parents,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  lk: Lookups;
  item?: Item;
  fin?: Item | null;
  finance: boolean;
  isNew: boolean;
  parents: { id: string; name: string }[];
}) {
  const v = (k: string) => item?.[k] ?? "";
  return (
    <ActionForm action={action}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <FormSection title="Identity" description="What the item is and how to recognise it.">
        <label className="field sm:col-span-2">
          <span>Item name *</span>
          <input name="name" className="input" required defaultValue={v("name")} maxLength={200} />
        </label>
        <label className="field">
          <span>Brand</span>
          <input name="brand" className="input" defaultValue={v("brand")} />
        </label>
        <label className="field">
          <span>Model number</span>
          <input name="model_number" className="input" defaultValue={v("model_number")} placeholder="blank or TBD allowed" />
        </label>
        <label className="field">
          <span>Serial number</span>
          <input name="serial_number" className="input" defaultValue={v("serial_number")} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-[0.9375rem]">
          <input type="checkbox" name="model_tbd" defaultChecked={!!item?.model_tbd} /> Model TBD (adds to To verify list)
        </label>
        <label className="field">
          <span>Type *</span>
          <select name="type" className="input" required defaultValue={v("type")}>
            {lk.types.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Subtype</span>
          <select name="subtype" className="input" defaultValue={v("subtype")}>
            <option value="">—</option>
            {lk.subtypes.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
      </FormSection>

      <FormSection title="Stock & condition" description="How many there are, who owns them and what shape they are in.">
        {isNew ? (
          <>
            <label className="field">
              <span>Quantity mode *</span>
              <select name="quantity_mode" className="input" defaultValue="Single">
                <option>Single</option>
                <option>Counted</option>
              </select>
              <span className="field-hint !font-normal">Single = one tracked unit. Counted = a pool of identical units.</span>
            </label>
            <label className="field">
              <span>Stock (Counted only)</span>
              <input name="stock" type="number" min={0} className="input" defaultValue={1} />
            </label>
          </>
        ) : (
          <p className="muted text-sm sm:col-span-2">
            Quantity mode and stock: {item?.quantity_mode}, stock {item?.stock}. Change stock with “Correct stock” on the item page (logged with a reason).
          </p>
        )}
        <label className="field">
          <span>Condition *</span>
          <select name="condition" className="input" defaultValue={v("condition") || "Good"}>
            {lk.conditions.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Owner *</span>
          <select name="owner_person_id" className="input" defaultValue={v("owner_person_id") || lk.people.find((p) => p.is_madtown)?.id}>
            {lk.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Home location</span>
          <select name="home_location_id" className="input" defaultValue={v("home_location_id")}>
            {lk.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </FormSection>

      <FormSection title="Relationships & labelling" description="Parent items, cases and where the QR label is stuck.">
        <label className="field">
          <span>Parent item (accessory of)</span>
          <input name="parent_item_id" className="input" list="parents" defaultValue={v("parent_item_id")} placeholder="MTMH_101" />
        </label>
        <label className="field">
          <span>Travels in case/bag (item ID)</span>
          <input name="case_item_id" className="input" list="parents" defaultValue={v("case_item_id")} />
        </label>
        <datalist id="parents">
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </datalist>
        <label className="field">
          <span>Case capacity note</span>
          <input name="case_capacity_note" className="input" defaultValue={v("case_capacity_note")} placeholder="holds 2 stands, not 4" />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-[0.9375rem]">
          <input type="checkbox" name="needs_case" defaultChecked={!!item?.needs_case} /> Has no proper case (flag)
        </label>
        <label className="field">
          <span>QR label goes on</span>
          <select name="label_target" className="input" defaultValue={v("label_target") || "Item"}>
            {["Item", "Pouch", "Case", "Kit"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Label note</span>
          <input name="label_note" className="input" defaultValue={v("label_note")} placeholder="label on the lens-cap pouch" />
        </label>
      </FormSection>

      <FormSection title="Verification & notes" description="Flag details that still need checking.">
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="to_verify" defaultChecked={!!item?.to_verify} /> To verify
        </label>
        <label className="field">
          <span>To verify reason</span>
          <input name="to_verify_reason" className="input" defaultValue={v("to_verify_reason")} />
        </label>
        <label className="field sm:col-span-2">
          <span>Notes (context only)</span>
          <textarea name="notes" className="input" rows={3} defaultValue={v("notes")} />
        </label>
      </FormSection>

      {finance && (
        <FormSection title="Purchase details" description="Hidden from Staff.">
          <label className="field">
            <span>Purchase date</span>
            <input name="purchase_date" type="date" className="input" defaultValue={fin?.purchase_date ? String(fin.purchase_date).slice(0, 10) : ""} />
          </label>
          <label className="field">
            <span>Vendor</span>
            <input name="vendor" className="input" defaultValue={fin?.vendor ?? ""} />
          </label>
          <label className="field">
            <span>Order number</span>
            <input name="order_ref" className="input" defaultValue={fin?.order_ref ?? ""} />
          </label>
          <label className="field">
            <span>Price (Rs)</span>
            <input name="purchase_price" type="number" step="0.01" min={0} className="input" defaultValue={fin?.purchase_price ?? ""} />
          </label>
          <label className="field">
            <span>Warranty until</span>
            <input name="warranty_until" type="date" className="input" defaultValue={fin?.warranty_until ? String(fin.warranty_until).slice(0, 10) : ""} />
          </label>
          <label className="field">
            <span>Price note</span>
            <input name="price_note" className="input" defaultValue={fin?.price_note ?? ""} placeholder="incl GST" />
          </label>
        </FormSection>
      )}
      <div className="sticky-actions">
        <Submit>{isNew ? "Create item" : "Save changes"}</Submit>
        <Link href={isNew ? "/items" : `/items/${item?.id}`} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </ActionForm>
  );
}
