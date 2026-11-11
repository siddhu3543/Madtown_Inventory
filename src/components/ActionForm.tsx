"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

type State = { ok?: boolean; error?: string; code?: string; message?: string; data?: Record<string, unknown> } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

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
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state) onResult?.(state);
  }, [state, resetOnSuccess, onResult]);
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      {state?.error && (
        <p role="alert" data-testid="form-error" className="mt-3 rounded-md border-2 border-[var(--color-bad)] p-3 font-semibold text-[var(--color-bad)]">
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p role="status" data-testid="form-ok" className="mt-3 rounded-md border-2 border-[var(--color-ok)] p-3 font-semibold text-[var(--color-ok)]">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function Submit({
  children,
  className = "btn btn-primary",
  name,
  value,
  disabled,
  confirm,
}: {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      disabled={pending || disabled}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}
