"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

type State = { ok?: boolean; error?: string; code?: string; message?: string; data?: Record<string, unknown> } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

/**
 * Server-action form. Errors show inline next to the form (role=alert); success messages appear as a
 * dismissible toast (role=status). Test ids form-error / form-ok are unchanged.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onResult,
  id,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onResult?: (s: State) => void;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [dismissed, setDismissed] = useState<State>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state) onResult?.(state);
  }, [state, resetOnSuccess, onResult]);
  useEffect(() => {
    if (!state?.ok || !state.message) return;
    const t = setTimeout(() => setDismissed(state), 12000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      {state?.error && (
        <p role="alert" data-testid="form-error" className="alert alert-bad mt-3 w-full font-medium">
          <AlertCircle size={18} aria-hidden />
          <span className="min-w-0">{state.error}</span>
        </p>
      )}
      {state?.ok && state.message && dismissed !== state && (
        <div className="toast-region no-print">
          <p role="status" data-testid="form-ok" className="toast">
            <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-ok)]" />
            <span className="min-w-0 flex-1">{state.message}</span>
            <button type="button" className="-m-1 rounded p-1 opacity-70 hover:opacity-100" aria-label="Dismiss message" onClick={() => setDismissed(state)}>
              <X size={16} aria-hidden />
            </button>
          </p>
        </div>
      )}
    </form>
  );
}

/** Submit button with pending state. `confirm` opens an in-page confirmation dialog before submitting. */
export function Submit({
  children,
  className = "btn btn-primary",
  name,
  value,
  disabled,
  confirm,
  confirmLabel = "Confirm",
}: {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  confirm?: string;
  confirmLabel?: string;
}) {
  const { pending } = useFormStatus();
  const btn = useRef<HTMLButtonElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const approved = useRef(false);
  return (
    <>
      <button
        ref={btn}
        type="submit"
        className={className}
        name={name}
        value={value}
        disabled={pending || disabled}
        onClick={(e) => {
          if (confirm && !approved.current) {
            e.preventDefault();
            dlg.current?.showModal();
          }
          approved.current = false;
        }}
      >
        {pending ? (
          <>
            <Loader2 size={16} aria-hidden className="animate-spin" /> Saving…
          </>
        ) : (
          children
        )}
      </button>
      {confirm && (
        <dialog ref={dlg} className="dialog" aria-label="Please confirm">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
              <AlertCircle size={18} aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">Are you sure?</h2>
              <p className="muted mt-1 text-[0.9375rem]">{confirm}</p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => dlg.current?.close()}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                dlg.current?.close();
                approved.current = true;
                btn.current?.click();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
