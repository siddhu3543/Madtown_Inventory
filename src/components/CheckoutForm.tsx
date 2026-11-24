"use client";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CloudOff, LogOut, ShieldAlert } from "lucide-react";
import { PhotoCapture } from "./PhotoCapture";
import { useKeepInput } from "./ActionForm";

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
  /** yes/no per person: is a valid email / phone on file (values are never sent to the browser) */
  contactStatus: Record<string, { has_email: boolean; has_phone: boolean }>;
};

const PHONE_PATTERN = "[0-9+\\s.\\-\\(\\)]{10,20}";
const PHONE_HINT = "10 to 15 digits; spaces, +, - and brackets are fine";
/** marks a mandatory field */
export function Req() {
  return (
    <span className="text-[var(--color-bad)]" aria-hidden>
      *
    </span>
  );
}

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary w-full text-base sm:w-auto sm:min-w-48" style={{ minHeight: 52 }} disabled={pending} data-testid="checkout-submit">
      <LogOut size={18} aria-hidden /> {pending ? "Saving…" : "Check out"}
    </button>
  );
}

/**
 * SCR-07. Every detail of the borrower is mandatory (2026-11-24): who borrows (chosen explicitly, or a new borrower with name,
 * email and phone), their email and phone when not on file yet, purpose / project, due date and condition. The server and the
 * database check the same rules; the browser checks them first so nothing is lost on a slow connection.
 */
export function CheckoutForm(p: Props) {
  const [state, formAction] = useActionState(p.action, null);
  const formRef = useRef<HTMLFormElement>(null);
  useKeepInput(formRef); // a server-side error must not wipe what the borrower told us
  const [borrower, setBorrower] = useState("");
  const contact = borrower && borrower !== "__new" ? p.contactStatus[borrower] : undefined;
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
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="checkout-form">
      {p.target.item_id && <input type="hidden" name="item_id" value={p.target.item_id} />}
      {p.target.kit_id && <input type="hidden" name="kit_id" value={p.target.kit_id} />}
      <label className="field">
        <span>
          Borrower <Req />
        </span>
        <select name="borrower_person_id" className="input" value={borrower} onChange={(e) => setBorrower(e.target.value)} disabled={!p.canOthers} required data-testid="borrower">
          <option value="" disabled>
            Choose the borrower…
          </option>
          {p.people.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.id === p.me ? " (me)" : x.has_login ? "" : " (no login)"}
              {p.borrowerOverdue[x.id] ? ` — ${p.borrowerOverdue[x.id]} overdue` : ""}
            </option>
          ))}
          {p.canOthers && <option value="__new">+ New borrower…</option>}
        </select>
        {!p.canOthers && <input type="hidden" name="borrower_person_id" value={p.me} />}
      </label>
      {borrower === "__new" && (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="new-borrower">
          <label className="field">
            <span>
              Full name <Req />
            </span>
            <input name="new_name" className="input" autoComplete="off" required data-testid="new-name" />
          </label>
          <label className="field">
            <span>
              Email <Req />
            </span>
            <input name="new_email" type="email" className="input" autoComplete="off" required data-testid="new-email" />
          </label>
          <label className="field">
            <span>
              Phone <Req />
            </span>
            <input name="new_phone" type="tel" inputMode="tel" className="input" pattern={PHONE_PATTERN} title={PHONE_HINT} required data-testid="new-phone" />
          </label>
        </div>
      )}
      {contact && (!contact.has_email || !contact.has_phone) && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="borrower-contact">
          <p className="muted text-sm sm:col-span-2">This borrower&apos;s contact details are incomplete. They are saved with the borrower for reminders.</p>
          {!contact.has_email && (
            <label className="field">
              <span>
                Borrower&apos;s email <Req />
              </span>
              <input name="contact_email" type="email" className="input" autoComplete="off" required data-testid="contact-email" />
            </label>
          )}
          {!contact.has_phone && (
            <label className="field">
              <span>
                Borrower&apos;s phone <Req />
              </span>
              <input name="contact_phone" type="tel" inputMode="tel" className="input" pattern={PHONE_PATTERN} title={PHONE_HINT} required data-testid="contact-phone" />
            </label>
          )}
        </div>
      )}
      {p.target.counted && (
        <label className="field">
          <span>
            Quantity ({p.target.available} available) <Req />
          </span>
          <input name="quantity" type="number" min={1} defaultValue={1} className="input" required data-testid="quantity" />
        </label>
      )}
      <label className="field">
        <span>
          Purpose or project / shoot <Req />
        </span>
        <input name="purpose" className="input" placeholder="e.g. Shorefest shoot" required data-testid="purpose" />
      </label>
      <label className="field">
        <span>
          Due back (IST) <Req />
        </span>
        <input name="due_at" type="datetime-local" className="input" defaultValue={p.defaultDue} required data-testid="due" />
      </label>
      <label className="field">
        <span>
          Condition at check-out <Req />
          {p.defaultCondition && <span className="muted font-normal"> — last recorded: {p.defaultCondition}</span>}
        </span>
        <select name="condition_out" className="input" defaultValue="" required data-testid="condition-out">
          <option value="" disabled>
            Check the item and choose…
          </option>
          {p.conditions.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {p.target.photoItems.map((pi) => (
        <PhotoCapture key={pi.id} itemId={pi.id} kind="Check-out" required={p.target.photoRequired} label={`Check-out photo of ${pi.id} (${pi.type})`} />
      ))}
      {p.canOverride && needsOverride && (
        <fieldset className="alert alert-warn flex-col !items-stretch gap-3">
          <legend className="flex items-center gap-2 px-1 font-semibold">
            <ShieldAlert size={16} aria-hidden /> Admin override
          </legend>
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
        <label className="alert alert-warn items-center font-semibold">
          <input type="checkbox" name="ack_reservation" /> I know it is reserved by someone else; check out anyway
        </label>
      )}
      {state?.error && (
        <p role="alert" data-testid="form-error" className="alert alert-bad font-medium">
          <AlertCircle size={18} aria-hidden />
          <span className="min-w-0">{state.error}</span>
        </p>
      )}
      {queuedMsg && (
        <p role="status" data-testid="queued" className="alert alert-warn font-medium">
          <CloudOff size={18} aria-hidden />
          <span className="min-w-0">{queuedMsg}</span>
        </p>
      )}
      <div className="sticky-actions">
        <Btn />
      </div>
    </form>
  );
}
