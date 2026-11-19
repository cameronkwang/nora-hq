"use client";

import { useState } from "react";
import { setChecklistStepAction } from "@/app/(app)/calendar/schedule-actions";
import type { ChecklistSection } from "@/lib/shoot-checklist";
import { Status, cx } from "./ui";

/**
 * The shoot checklist as big one-thumb rows. Ticks show at once and save in the background; a failed save
 * puts the tick back and says so.
 * Ink: each part (Day before, On site, After) is a section on the ink rule with its "3/13" on the right, then one
 * row per step on hairlines: an ink box, the step, its hint in muted under it. The whole row is the target.
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
    <div className="shoot">
      {error && (
        <p role="alert" className="notice">
          <Status tone="danger" className="whitespace-normal">
            {error}
          </Status>
        </p>
      )}
      {sections.map((section) => {
        const count = section.steps.filter((s) => done.has(s.id)).length;
        const all = count === section.steps.length;
        return (
          <section key={section.key} aria-labelledby={`sec-${section.key}`} className="sec">
            <header className="sec-head">
              <h2 id={`sec-${section.key}`} className="title">
                {section.title}
              </h2>
              {all ? (
                <Status tone="ok" small className="num">
                  {count}/{section.steps.length}
                </Status>
              ) : (
                <span className="meta num">
                  {count}/{section.steps.length}
                </span>
              )}
            </header>
            {section.note && <p className="sec-note">{section.note}</p>}
            <ul className="list">
              {section.steps.map((step) => {
                const on = done.has(step.id);
                return (
                  <li key={step.id}>
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(step.id)} className={cx("shoot-step", on && "is-done")}>
                      <i aria-hidden />
                      <span className="min-w-0">
                        <span className="shoot-label">{step.label}</span>
                        {step.hint && <span className="meta block">{step.hint}</span>}
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
