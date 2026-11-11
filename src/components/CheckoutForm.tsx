"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { PhotoCapture } from "./PhotoCapture";

type State = { ok?: boolean; error?: string; code?: string } | null;
type Props = {
  action: (s: State, fd: FormData) => Promise<State>;
  target: { item_id?: string; kit_id?: string; label: string; counted: boolean; available: number; photoRequired: boolean; photoItems: { id: string; type: string }[] };
  people: { id: string; name: string; has_login: boolean }[];
  me: string;
  canOthers: boolean;
  canOverride: boolean;
  conditions: string[];
  defaultCondition: string | null;
  defaultDue: string;
  locations: { id: string; name: string }[];
  borrowerOverdue: Record<string, number>;
};

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary w-full text-lg" style={{ minHeight: 60 }} disabled={pending} data-testid="checkout-submit">
      {pending ? "Saving…" : "Check out"}
    </button>
  );
}

/** SCR-07. NFR-011: after scanning, Check out is one tap when defaults fit (borrower = me, default due, current condition). */
export function CheckoutForm(p: Props) {
  const [state, formAction] = useActionState(p.action, null);
  const [borrower, setBorrower] = useState(p.me);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const needsOverride = state?.code === "OVERDUE_NEEDS_REASON" || state?.code === "ALREADY_OUT" || (p.borrowerOverdue[borrower] ?? 0) > 0;
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (navigator.onLine) return;
    e.preventDefault(); // NFR-014: queue while offline; NOT confirmed until the server accepts it
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries([...fd.entries()].filter(([k]) => k !== "photo_ids"));
    payload.photo_ids = fd.getAll("photo_ids");
    payload.offline = true;
    const { enqueue } = await import("@/lib/client/offline-queue");
    await enqueue("checkout", payload, `Check out ${p.target.label}`);
    setQueuedMsg("You are offline. The check-out is queued and NOT confirmed until it syncs. Do not hand over gear on the strength of this alone.");
  }
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="checkout-form">
      {p.target.item_id && <input type="hidden" name="item_id" value={p.target.item_id} />}
      {p.target.kit_id && <input type="hidden" name="kit_id" value={p.target.kit_id} />}
      <label className="field">
        <span>Borrower</span>
        <select name="borrower_person_id" className="input" value={borrower} onChange={(e) => setBorrower(e.target.value)} disabled={!p.canOthers} data-testid="borrower">
          {p.people.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.id === p.me ? " (me)" : x.has_login ? "" : " (no login)"}
              {p.borrowerOverdue[x.id] ? ` — ${p.borrowerOverdue[x.id]} overdue` : ""}
            </option>
          ))}
          {p.canOthers && <option value="__new">+ New borrower without login…</option>}
        </select>
        {!p.canOthers && <input type="hidden" name="borrower_person_id" value={p.me} />}
      </label>
      {borrower === "__new" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="field">
            <span>Name</span>
            <input name="new_name" className="input" required />
          </label>
          <label className="field">
            <span>Email (optional, for reminders)</span>
            <input name="new_email" type="email" className="input" />
          </label>
          <label className="field">
            <span>Phone (optional)</span>
            <input name="new_phone" className="input" />
          </label>
        </div>
      )}
      {p.target.counted && (
        <label className="field">
          <span>Quantity ({p.target.available} available)</span>
          <input name="quantity" type="number" min={1} defaultValue={1} className="input" data-testid="quantity" />
        </label>
      )}
      <label className="field">
        <span>Purpose or project / shoot</span>
        <input name="purpose" className="input" placeholder="e.g. Shorefest shoot" />
      </label>
      <label className="field">
        <span>Due back (IST)</span>
        <input name="due_at" type="datetime-local" className="input" defaultValue={p.defaultDue} required data-testid="due" />
      </label>
      <label className="field">
        <span>Condition at check-out</span>
        <select name="condition_out" className="input" defaultValue={p.defaultCondition ?? p.conditions[0]}>
          {p.conditions.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {p.target.photoItems.map((pi) => (
        <PhotoCapture key={pi.id} itemId={pi.id} kind="Check-out" required={p.target.photoRequired} label={`Check-out photo of ${pi.id} (${pi.type})`} />
      ))}
      {p.canOverride && needsOverride && (
        <fieldset className="card border-[var(--color-warn)] p-3">
          <legend className="font-semibold">Manager override</legend>
          {state?.code === "ALREADY_OUT" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="override_double" /> Close the previous open loan (item is physically here)
            </label>
          )}
          <label className="field">
            <span>Reason (recorded)</span>
            <input name="override_reason" className="input" data-testid="override-reason" />
          </label>
        </fieldset>
      )}
      {state?.code === "RESERVED_CONFLICT" && (
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" name="ack_reservation" /> I know it is reserved by someone else; check out anyway
        </label>
      )}
      {state?.error && (
        <p role="alert" data-testid="form-error" className="rounded-md border-2 border-[var(--color-bad)] p-3 font-semibold text-[var(--color-bad)]">
          {state.error}
        </p>
      )}
      {queuedMsg && (
        <p role="status" data-testid="queued" className="rounded-md border-2 border-[var(--color-warn)] p-3 font-semibold">
          {queuedMsg}
        </p>
      )}
      <Btn />
    </form>
  );
}
