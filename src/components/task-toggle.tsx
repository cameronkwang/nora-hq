"use client";

import { useFormStatus } from "react-dom";
import { cx } from "./ui";
import { useTaskSelection } from "./task-selection";

/** Round checkbox-style submit button for the done toggle. Shows the new state while the action runs. */
export function TaskToggleButton({ done, title }: { done: boolean; title: string }) {
  const { pending } = useFormStatus();
  // While bulk-selecting, the row's select checkbox takes this spot.
  const selection = useTaskSelection();
  if (selection?.selecting) return null;
  const shown = pending ? !done : done;
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={done ? `Mark “${title}” not done` : `Mark “${title}” done`}
      aria-pressed={done}
      className={cx(
        "tap-target flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition",
        shown ? "border-ok bg-ok text-surface" : "border-border bg-surface hover:border-ok",
        pending && "opacity-60",
      )}
    >
      {shown && (
        <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
