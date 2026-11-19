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
    <button type="submit" role="switch" aria-checked={active} disabled={pending} className="switch biz-switch">
      {/* is-on / is-off draw the state shown right away; aria-checked stays the saved one until the action lands */}
      <span aria-hidden className={cx("switch-track", on ? "is-on" : "is-off")} />
      <span className="min-w-0">
        {on ? "Active" : "Inactive"}
        {!on && <span className="biz-switch-note"> · hidden from Home, sidebar and Claude&apos;s briefing</span>}
      </span>
    </button>
  );
}
