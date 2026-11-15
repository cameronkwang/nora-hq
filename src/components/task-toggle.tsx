"use client";

import { useFormStatus } from "react-dom";
import { cx } from "./ui";
import { useTaskSelection } from "./task-selection";

/** The done tick: an ink square (filled = done) that submits its form. Shows the new state while the action runs. */
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
      className={cx("tick", shown && "is-done", !shown && done && "is-undo")}
    >
      <i aria-hidden />
    </button>
  );
}
