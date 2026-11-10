"use client";

import { useState, type ReactNode } from "react";
import { cx } from "./ui";

export type BoardColumn = { stage: string; label: string; count: number; content: ReactNode };

/**
 * Layout shell for the outreach pipeline. Phones: one stage at a time, picked with a stage switcher
 * (no sideways board). Tablet/desktop: every stage side by side, scrolling inside its own box.
 */
export function OutreachBoard({ columns }: { columns: BoardColumn[] }) {
  const firstBusy = columns.find((c) => c.count > 0)?.stage ?? columns[0]?.stage ?? "";
  const [active, setActive] = useState(firstBusy);
  const idx = Math.max(0, columns.findIndex((c) => c.stage === active));
  const go = (d: number) => setActive(columns[(idx + d + columns.length) % columns.length].stage);

  return (
    <div>
      {/* Phone stage switcher */}
      <div className="mb-3 flex items-center gap-2 md:hidden">
        <button type="button" onClick={() => go(-1)} aria-label="Previous stage" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
          <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <label className="sr-only" htmlFor="pipeline-stage">Stage</label>
        <select id="pipeline-stage" className="input font-medium" value={columns[idx]?.stage} onChange={(e) => setActive(e.target.value)}>
          {columns.map((c) => (
            <option key={c.stage} value={c.stage}>{c.label} ({c.count})</option>
          ))}
        </select>
        <button type="button" onClick={() => go(1)} aria-label="Next stage" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
          <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="md:relative md:overflow-x-auto md:pb-2" role="region" aria-label="Outreach pipeline" tabIndex={0}>
        <ol className="md:flex md:gap-3">
          {columns.map((c) => (
            <li
              key={c.stage}
              className={cx(
                "flex-col rounded-xl border border-border bg-surface-2/60 md:flex md:w-64 md:shrink-0",
                c.stage === columns[idx]?.stage ? "flex" : "hidden",
              )}
            >
              <h3 className="hidden items-center justify-between px-3 py-2 text-xs font-semibold md:flex">
                <span>{c.label}</span>
                <span className="tabular-nums text-muted">{c.count}</span>
              </h3>
              <div className="flex flex-1 flex-col p-2 md:pt-0">{c.content}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
