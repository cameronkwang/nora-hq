"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ASSIGNEES, TASK_STATUSES } from "@/lib/schema";
import { buttonClass, cx, humanize } from "./ui";

type Opt = { id: string; label: string };

/**
 * Tasks filter bar: "Mine" toggle, Business, Status up front; Assigned to / Month / Group by tucked behind "Filters".
 * A plain GET form; selects apply as soon as they change (the Apply button is there for no-JS).
 */
export function TaskFilters({
  view, client, assignee, status, month, group, sort, dir,
  clients, months, mineHref, clearHref, filtered,
}: {
  view: string;
  client: string;
  assignee: string;
  status: string;
  month: string;
  group: string;
  sort: string;
  dir: string;
  clients: Opt[];
  months: Array<{ value: string; label: string }>;
  mineHref: string;
  clearHref: string;
  filtered: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const extra = (assignee && assignee !== "me" ? 1 : 0) + (month ? 1 : 0) + (view === "list" && group === "business" ? 1 : 0);
  const [open, setOpen] = useState(extra > 0);
  const apply = () => form.current?.requestSubmit();
  const mine = assignee === "me";

  return (
    <form ref={form} method="get" action="/tasks" className="mb-4">
      {view !== "list" && <input type="hidden" name="view" value={view} />}
      {view === "list" && <input type="hidden" name="view" value="list" />}
      {view === "table" && sort !== "due" && <input type="hidden" name="sort" value={sort} />}
      {view === "table" && dir === "desc" && <input type="hidden" name="dir" value={dir} />}
      {view !== "list" && group === "business" && <input type="hidden" name="group" value={group} />}

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Link
          href={mineHref}
          aria-pressed={mine}
          className={cx(
            buttonClass(mine ? "primary" : "secondary"),
            "order-1 rounded-full sm:order-none",
          )}
        >
          {mine && (
            <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          Mine
        </Link>

        <div className={cx("order-3 sm:order-none sm:w-60", view === "board" && "col-span-2")}>
          <label htmlFor="f-client" className="sr-only">Business</label>
          <select id="f-client" name="client" defaultValue={client} onChange={apply} className="input">
            <option value="">All businesses</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
            <option value="none">No business</option>
          </select>
        </div>

        {view === "board" ? (
          status !== "open" && <input type="hidden" name="status" value={status} />
        ) : (
          <div className="order-4 sm:order-none sm:w-40">
            <label htmlFor="f-status" className="sr-only">Status</label>
            <select id="f-status" name="status" defaultValue={status} onChange={apply} className="input">
              <option value="open">Not done</option>
              <option value="all">All statuses</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </select>
          </div>
        )}

        <div className="order-2 flex items-center justify-end gap-1 sm:order-none">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="task-more-filters"
            onClick={() => setOpen((o) => !o)}
            className={cx(buttonClass("ghost"), "text-muted")}
          >
            Filters
            {extra > 0 && <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg">{extra}</span>}
            <svg viewBox="0 0 16 16" aria-hidden className={cx("size-3.5 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {filtered && (
            <Link href={clearHref} className={cx(buttonClass("ghost"), "text-muted")}>
              Clear
            </Link>
          )}
        </div>
      </div>

      <div id="task-more-filters" hidden={!open} className="mt-2 rounded-xl border border-border bg-surface p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {mine ? (
            <input type="hidden" name="assignee" value="me" />
          ) : (
            <div>
              <label htmlFor="f-assignee" className="label">Assigned to</label>
              <select id="f-assignee" name="assignee" defaultValue={assignee} onChange={apply} className="input">
                <option value="">Anyone</option>
                {ASSIGNEES.map((a) => (
                  <option key={a} value={a}>{humanize(a)}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="f-month" className="label">Counts toward month</label>
            <select id="f-month" name="month" defaultValue={month} onChange={apply} className="input">
              <option value="">Any month</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          {view === "list" && (
            <div>
              <label htmlFor="f-group" className="label">Group by</label>
              <select id="f-group" name="group" defaultValue={group} onChange={apply} className="input">
                <option value="due">Due date</option>
                <option value="business">Business</option>
              </select>
            </div>
          )}
        </div>
        <noscript>
          <button className={cx(buttonClass("secondary"), "mt-3")}>Apply</button>
        </noscript>
      </div>
    </form>
  );
}
