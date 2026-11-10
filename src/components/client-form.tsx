"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "./ui";

export type ActionFormState = { ok?: boolean; error?: string; message?: string; at?: number };

/**
 * A <form> wired to a server action through useActionState, with an inline success/error line.
 * The action must have the (prevState, formData) signature and return ActionFormState.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  ariaLabel,
}: {
  action: (state: ActionFormState, fd: FormData) => Promise<ActionFormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  ariaLabel?: string;
}) {
  const [state, formAction] = useActionState(action, {} as ActionFormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state.at, state.ok, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} aria-label={ariaLabel}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}

function FormMessage({ state }: { state: ActionFormState }) {
  if (!state.error && !state.message) return <p className="sr-only" role="status" aria-live="polite" />;
  return (
    <p role="status" aria-live="polite" className={cx("mt-2 text-xs", state.error ? "text-danger" : "text-ok")}>
      {state.error ?? state.message}
    </p>
  );
}

/** Submit button that disables itself and shows a pending label while the action runs. */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  variant = "primary",
  size = "md",
  className,
  formAction,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} formAction={formAction} className={cx(buttonClass(variant, size), className)}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Button for a plain <form action={serverAction}> that asks for confirmation first. */
export function ConfirmButton({
  children,
  confirm,
  variant = "danger",
  size = "sm",
  formAction,
  className,
}: {
  children: ReactNode;
  confirm: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  formAction?: (fd: FormData) => void | Promise<void>;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      formAction={formAction}
      formNoValidate
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
      className={cx(buttonClass(variant, size), className)}
    >
      {children}
    </button>
  );
}
