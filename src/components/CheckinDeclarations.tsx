"use client";
import { useState } from "react";
import { Req } from "./CheckoutForm";

type Line = { item_id: string; name: string };

function YesNo({ name, value, onChange, testId }: { name: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="flex gap-4" role="radiogroup">
      {(["no", "yes"] as const).map((v) => (
        <label key={v} className="flex items-center gap-2 font-medium">
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} required data-testid={`${testId}-${v}`} />
          {v === "yes" ? "Yes" : "No"}
        </label>
      ))}
    </div>
  );
}

/**
 * What the borrower reports at check-in (2026-11-24: all mandatory). Damage and missing parts are explicit Yes / No questions
 * so nothing is skipped by accident; a "Yes" makes its description required. Return notes are always required.
 */
export function CheckinDeclarations({ lines }: { lines: Line[] }) {
  const [damage, setDamage] = useState("");
  const [missing, setMissing] = useState("");
  return (
    <>
      <fieldset className="card flex flex-col gap-3 p-3" data-testid="damage-question">
        <legend className="font-semibold">
          Any damage? <Req />
        </legend>
        <YesNo name="damage_answer" value={damage} onChange={setDamage} testId="damage" />
        {damage === "yes" && (
          <label className="field">
            <span>
              Describe the damage <Req /> <span className="muted font-normal">— a repair is opened and the item goes In repair</span>
            </span>
            <textarea name="damage_description" className="input" rows={2} required data-testid="damage-description" />
          </label>
        )}
      </fieldset>
      <fieldset className="card flex flex-col gap-3 p-3" data-testid="missing-question">
        <legend className="font-semibold">
          Anything missing (chargers, cables, caps, cases)? <Req />
        </legend>
        <YesNo name="missing_answer" value={missing} onChange={setMissing} testId="missing" />
        {missing === "yes" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="field">
              <span>
                Missing from <Req />
              </span>
              <select name="missing_item_id" className="input" required>
                {lines.map((l) => (
                  <option key={l.item_id} value={l.item_id}>
                    {l.item_id} {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                What is missing <Req />
              </span>
              <input name="missing_description" className="input" placeholder="e.g. charging cable" required data-testid="missing-description" />
            </label>
          </div>
        )}
      </fieldset>
      <label className="field">
        <span>
          Return notes <Req /> <span className="muted font-normal">— what the borrower said; write “No issues” if nothing</span>
        </span>
        <textarea name="notes" className="input" rows={2} required data-testid="checkin-notes" />
      </label>
    </>
  );
}
