"use client";

import { useFormStatus } from "react-dom";
import { cx } from "@/components/ui";

/**
 * Active / Inactive switch for a business (used on the business page and in Settings).
 * `action` is setBusinessActiveAction bound to (clientId, !active). One tap flips it; it's reversible, so no confirm.
 */
export function ActiveToggle({ active, action, className }: { active: boolean; action: () => Promise<void>; className?: string }) {
  return (
    <form action={action} className={className}>
      <Switch active={active} />
    </form>
  );
}

function Switch({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  const on = pending ? !active : active; // show the new state right away
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={active}
      disabled={pending}
      className="group inline-flex min-h-11 max-w-full items-center gap-3 rounded-lg py-1 pr-2 text-left text-sm disabled:opacity-70"
    >
      <span
        aria-hidden
        className={cx(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          on ? "border-transparent bg-ok" : "border-border bg-surface-2",
        )}
      >
        <span className={cx("inline-block size-5 rounded-full bg-surface shadow-sm transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </span>
      <span className="min-w-0">
        <span className="font-medium">{on ? "Active" : "Inactive"}</span>
        {!on && <span className="text-muted"> — hidden from Home, sidebar and Claude&apos;s briefing</span>}
      </span>
    </button>
  );
}
