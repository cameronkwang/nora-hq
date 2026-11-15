"use client";

import { useState } from "react";
import { useTaskSelection } from "./task-selection";

/**
 * One collapsible plan item ("Instagram feed posts · 3 of 8"), drawn as a row with a chevron in the tick's place.
 * Closed by default so the monthly plan's near-identical slots don't bury real tasks. Opens itself while tasks are
 * being bulk-selected on /tasks, so "Select all" never ticks rows nobody can see.
 */
export function PlanTaskGroup({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  const selecting = !!useTaskSelection()?.selecting;
  const [open, setOpen] = useState(false);
  return (
    <details
      className="group"
      open={open || selecting}
      onToggle={(e) => {
        // While selecting, the group is held open; don't remember that as the person's own choice.
        if (!selecting) setOpen(e.currentTarget.open);
      }}
    >
      <summary className="row group-row">
        <svg className="disc" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
        {summary}
      </summary>
      {children}
    </details>
  );
}
