"use client";

import { useFormStatus } from "react-dom";
import { buttonClass, cx, humanize } from "./ui";

/**
 * Compact stage picker for pipeline cards. Submits its <form> as soon as the stage changes;
 * the "Move" button stays for keyboard users and as a no-JS fallback.
 */
export function OutreachStageSelect({ current, label, stages }: { current: string; label: string; stages: readonly string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <select
        name="stage"
        aria-label={label}
        defaultValue={current}
        className="input py-1! text-xs! pointer-coarse:text-base!"
        onChange={(e) => {
          if (e.currentTarget.value !== current) e.currentTarget.form?.requestSubmit();
        }}
      >
        {stages.map((s) => (
          <option key={s} value={s}>{humanize(s)}</option>
        ))}
      </select>
      <MoveButton />
    </div>
  );
}

function MoveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("ghost", "sm"), "shrink-0")}>
      {pending ? "…" : "Move"}
    </button>
  );
}
