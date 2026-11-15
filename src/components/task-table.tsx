"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ASSIGNEES, PLATFORMS, TASK_STATUSES } from "@/lib/schema";
import { DateCell, SelectCell, TextCell } from "./task-cells";
import { TaskSelectAll, TaskSelectBox } from "./task-selection";
import { cx, humanize } from "./ui";

/** A task as the board and table need it (plain JSON from the server page). */
export type TaskLite = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  status: string;
  assignee: string;
  dueDate: string | null;
  platform: string | null;
  month: string;
};

export type SortCol = "title" | "business" | "status" | "assignee" | "due" | "platform" | "month";
const COLS: Array<{ key: SortCol; label: string }> = [
  { key: "title", label: "Title" },
  { key: "business", label: "Business" },
  { key: "status", label: "Status" },
  { key: "assignee", label: "Assignee" },
  { key: "due", label: "Due" },
  { key: "platform", label: "Platform" },
  { key: "month", label: "Month" },
];

// checkbox | title | business | status | assignee | due | platform | month | open
const GRID = "md:grid md:grid-cols-[2.5rem_minmax(11rem,2fr)_minmax(9rem,1.2fr)_8.5rem_7rem_8.5rem_7rem_5rem_2.25rem] md:items-center";

export const STATUS_OPTIONS = TASK_STATUSES.map((s) => ({ value: s, label: humanize(s) }));
const ASSIGNEE_OPTIONS = ASSIGNEES.map((a) => ({ value: a, label: humanize(a) }));
const PLATFORM_OPTIONS = [{ value: "", label: "None" }, ...PLATFORMS.map((p) => ({ value: p, label: p === "tiktok" ? "TikTok" : humanize(p) }))];

function monthShort(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Spreadsheet-style tasks: sortable headers (links, ?sort=&dir=), every cell edits in place and saves on its own.
 * Desktop: a dense grid on hairlines (caps head, no box) that scrolls sideways inside itself if the window is narrow.
 * Phone: one stacked block per task on hairlines, with the same controls. Wrap in <TaskSelection alwaysOn> for the
 * checkboxes / bulk bar.
 */
export function TaskTable({
  rows,
  clients,
  sort,
  dir,
  sortHrefs,
  today,
}: {
  rows: TaskLite[];
  clients: Array<{ id: string; label: string }>;
  sort: SortCol;
  dir: "asc" | "desc";
  /** `${col}:${dir}` → URL */
  sortHrefs: Record<string, string>;
  today: string;
}) {
  const router = useRouter();
  const clientOptions = [{ value: "", label: "No business" }, ...clients.map((c) => ({ value: c.id, label: c.label }))];

  return (
    <div>
      {/* Phone: sort + select all */}
      <div className="mb-2 flex items-center justify-between gap-3 md:hidden">
        <TaskSelectAll />
        <label className="meta ml-auto flex items-center gap-2">
          Sort
          <select
            className="input"
            style={{ width: "auto" }}
            value={`${sort}:${dir}`}
            onChange={(e) => router.push(sortHrefs[e.currentTarget.value] ?? "/tasks?view=table")}
          >
            {COLS.flatMap((c) => [
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} ↑</option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} ↓</option>,
            ])}
          </select>
        </label>
      </div>

      <div className="border-t border-border md:relative md:overflow-x-auto md:border-t-0">
        <div role="table" aria-label="Tasks" aria-rowcount={rows.length + 1} className="md:min-w-[60.75rem]">
          <div role="row" className={cx("task-table-head eyebrow hidden", GRID)}>
            <div role="columnheader" className="flex items-center justify-center py-2">
              <TaskSelectAll bare />
            </div>
            {COLS.map((c) => {
              const on = sort === c.key;
              const next = on && dir === "asc" ? "desc" : "asc";
              return (
                <div key={c.key} role="columnheader" aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"} className="px-1 py-1">
                  <Link href={sortHrefs[`${c.key}:${next}`]} scroll={false} className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5">
                    {c.label}
                    <span aria-hidden className={cx("text-[10px]", !on && "opacity-0")}>{on && dir === "desc" ? "▼" : "▲"}</span>
                  </Link>
                </div>
              );
            })}
            <div role="columnheader"><span className="sr-only">Open</span></div>
          </div>

          <div>
            {rows.map((t) => {
              const overdue = !!t.dueDate && t.status !== "done" && t.dueDate < today;
              const bizOptions =
                t.clientId && !clients.some((c) => c.id === t.clientId)
                  ? [...clientOptions, { value: t.clientId, label: t.clientName ?? "Archived business" }]
                  : clientOptions;
              return (
                <div
                  key={t.id}
                  role="row"
                  className={cx(
                    "task-table-row grid grid-cols-2 gap-x-3 gap-y-2 py-4",
                    "md:gap-0 md:py-0",
                    GRID,
                    t.status === "done" && "is-done md:text-muted",
                  )}
                >
                  <div role="cell" className="col-span-2 flex items-center gap-2 md:gap-0">
                    <div className="flex items-center justify-center md:w-10 md:shrink-0">
                      <TaskSelectBox id={t.id} title={t.title} className="m-0" />
                    </div>
                    <div className="min-w-0 flex-1 md:px-1 md:py-1">
                      <TextCell key={t.title} id={t.id} field="title" label="Title" value={t.title} inputClassName={cx("cell-title font-medium", t.status === "done" && "line-through")} />
                    </div>
                  </div>
                  <Cell label="Business" span>
                    <SelectCell key={t.clientId ?? ""} id={t.id} field="clientId" label="Business" value={t.clientId ?? ""} options={bizOptions} />
                  </Cell>
                  <Cell label="Status">
                    <SelectCell key={t.status} id={t.id} field="status" label="Status" value={t.status} options={STATUS_OPTIONS} />
                  </Cell>
                  <Cell label="Assignee">
                    <SelectCell key={t.assignee} id={t.id} field="assignee" label="Assignee" value={t.assignee} options={ASSIGNEE_OPTIONS} />
                  </Cell>
                  <Cell label="Due">
                    <DateCell key={t.dueDate ?? ""} id={t.id} field="dueDate" label="Due date" value={t.dueDate ?? ""} overdue={overdue} />
                  </Cell>
                  <Cell label="Platform">
                    <SelectCell key={t.platform ?? ""} id={t.id} field="platform" label="Platform" value={t.platform ?? ""} options={PLATFORM_OPTIONS} />
                  </Cell>
                  <div role="cell" className="meta col-span-2 flex items-center justify-between gap-2">
                    <span className="md:whitespace-nowrap md:px-3">
                      <span className="md:hidden">Counts toward </span>
                      {monthShort(t.month)}
                    </span>
                    <Link
                      href={`/tasks/${t.id}`}
                      aria-label={`Open “${t.title}”`}
                      title="Open task"
                      className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-2 font-medium text-text underline decoration-border-strong underline-offset-[3px] hover:decoration-text md:mr-0 md:min-h-0 md:w-9 md:justify-center md:px-0 md:py-1.5 md:text-muted md:no-underline md:hover:text-text"
                    >
                      <span className="md:hidden">Open &amp; notes</span>
                      <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
                        <path d="M6 3.5h6.5V10M12.5 3.5 4 12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, span, children }: { label: string; span?: boolean; children: React.ReactNode }) {
  return (
    <div role="cell" className={cx(span && "col-span-2 md:col-span-1", "md:px-1 md:py-1")}>
      <span aria-hidden className="label md:hidden">{label}</span>
      {children}
    </div>
  );
}
