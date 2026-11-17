"use client";

import { useState } from "react";
import { setChecklistStepAction } from "@/app/(app)/calendar/schedule-actions";
import type { ChecklistSection } from "@/lib/shoot-checklist";
import { cx } from "./ui";

/**
 * The shoot checklist as big one-thumb rows. Ticks show at once and save in the background; a failed save
 * puts the tick back and says so.
 */
export function ShootChecklist({ jobId, sections, initialDone }: { jobId: string; sections: ChecklistSection[]; initialDone: string[] }) {
  const [done, setDone] = useState(() => new Set(initialDone));
  const [error, setError] = useState("");

  async function toggle(stepId: string) {
    const next = !done.has(stepId);
    setError("");
    setDone((s) => {
      const n = new Set(s);
      if (next) n.add(stepId);
      else n.delete(stepId);
      return n;
    });
    const res = await setChecklistStepAction(jobId, stepId, next).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection." }));
    if (!res.ok) {
      setError(res.error);
      setDone((s) => {
        const n = new Set(s);
        if (next) n.delete(stepId);
        else n.add(stepId);
        return n;
      });
    }
  }

  return (
    <div className="grid gap-5">
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {sections.map((section) => {
        const count = section.steps.filter((s) => done.has(s.id)).length;
        const all = count === section.steps.length;
        return (
          <section key={section.key} aria-labelledby={`sec-${section.key}`}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 id={`sec-${section.key}`} className="text-base font-semibold">
                {section.title}
              </h2>
              <span className={cx("text-sm tabular-nums", all ? "font-semibold text-ok" : "text-muted")}>
                {count}/{section.steps.length}
              </span>
            </div>
            {section.note && <p className="mb-2 text-sm text-muted">{section.note}</p>}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {section.steps.map((step) => {
                const on = done.has(step.id);
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(step.id)}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
                    >
                      <span
                        aria-hidden
                        className={cx(
                          "flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold",
                          on ? "border-accent bg-accent text-accent-fg" : "border-border",
                        )}
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block text-[15px]", on && "text-muted line-through")}>{step.label}</span>
                        {step.hint && <span className="block text-xs text-muted">{step.hint}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
