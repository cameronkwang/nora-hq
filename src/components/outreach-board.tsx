"use client";

import { useState, type ReactNode } from "react";
import { buttonClass, cx } from "./ui";

export type BoardColumn = { stage: string; label: string; count: number; content: ReactNode };

/**
 * Layout shell for the outreach pipeline. Phones: one stage at a time, picked with a stage switcher
 * (no sideways board). Tablet/desktop: every stage side by side, scrolling inside its own region.
 * A column is a caps label on a hairline with a plain list under it: no column boxes, no card boxes.
 */
export function OutreachBoard({ columns }: { columns: BoardColumn[] }) {
  const firstBusy = columns.find((c) => c.count > 0)?.stage ?? columns[0]?.stage ?? "";
  const [active, setActive] = useState(firstBusy);
  const idx = Math.max(0, columns.findIndex((c) => c.stage === active));
  const go = (d: number) => setActive(columns[(idx + d + columns.length) % columns.length].stage);

  return (
    <div>
      {/* Phone stage switcher */}
      <div className="g-stagepick md:hidden">
        <button type="button" onClick={() => go(-1)} aria-label="Previous stage" className={buttonClass("secondary")}>
          <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <label className="sr-only" htmlFor="pipeline-stage">Stage</label>
        <select id="pipeline-stage" className="input font-medium" value={columns[idx]?.stage} onChange={(e) => setActive(e.target.value)}>
          {columns.map((c) => (
            <option key={c.stage} value={c.stage}>{c.label} ({c.count})</option>
          ))}
        </select>
        <button type="button" onClick={() => go(1)} aria-label="Next stage" className={buttonClass("secondary")}>
          <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="g-board-scroll md:overflow-x-auto md:pb-3" role="region" aria-label="Outreach pipeline" tabIndex={0}>
        <ol className="g-board">
          {columns.map((c) => (
            <li key={c.stage} className={cx("g-col", c.stage === columns[idx]?.stage ? "block" : "hidden")}>
              <h3 className="g-col-head">
                <span className="eyebrow">{c.label}</span>
                <span className="n">{c.count}</span>
              </h3>
              {c.content}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
