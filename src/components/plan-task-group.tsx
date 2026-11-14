"use client";

import { useState } from "react";
import { useTaskSelection } from "./task-selection";

/**
 * One collapsible plan item ("Instagram feed posts · 3 of 8 ▸"). Closed by default so the monthly plan's
 * near-identical slots don't bury real tasks. Opens itself while tasks are being bulk-selected on /tasks,
 * so "Select all" never ticks rows nobody can see.
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
      <summary className="no-marker -mx-2 flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-2">
        {summary}
        <span aria-hidden className="shrink-0 text-muted transition group-open:rotate-90">▸</span>
      </summary>
      {children}
    </details>
  );
}
