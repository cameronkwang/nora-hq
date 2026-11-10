"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { editTaskField } from "@/app/(app)/tasks/actions";
import { TASK_STATUSES } from "@/lib/schema";
import type { TaskLite } from "./task-table";
import { PlatformTag, cx, humanize } from "./ui";

const LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  needs_review: "Needs review",
  blocked: "Blocked",
  done: "Done",
};
const DOT: Record<string, string> = {
  todo: "bg-muted",
  in_progress: "bg-info",
  needs_review: "bg-warn",
  blocked: "bg-danger",
  done: "bg-ok",
};

function shortDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Kanban board. Desktop (lg+): five columns, drag a card to another column (native HTML5 drag & drop),
 * or use the status select on the card. Phone/tablet: one column at a time with a status switcher.
 * Moves are optimistic; the server action revalidates the page.
 */
export function BoardView({ tasks, today, olderDone, olderDoneHref, doneDays }: { tasks: TaskLite[]; today: string; olderDone: number; olderDoneHref: string; doneDays: number }) {
  const [optimistic, move] = useOptimistic(tasks, (state, m: { id: string; status: string }) => state.map((t) => (t.id === m.id ? { ...t, status: m.status } : t)));
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [mobileCol, setMobileCol] = useState<string>("todo");
  const [announce, setAnnounce] = useState("");

  const setStatus = (id: string, status: string) => {
    const t = optimistic.find((x) => x.id === id);
    if (!t || t.status === status) return;
    setError(null);
    start(async () => {
      move({ id, status });
      const r = await editTaskField(id, "status", status, true);
      if (!r.ok) setError(`Couldn’t move “${t.title}”: ${r.error}`);
      else setAnnounce(`Moved “${t.title}” to ${LABEL[status]}`);
    });
  };

  const cols = TASK_STATUSES.map((s) => ({ status: s, tasks: optimistic.filter((t) => t.status === s) }));

  const column = (c: (typeof cols)[number], phone: boolean) => (
    <section
      key={c.status}
      aria-label={LABEL[c.status]}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== c.status) setOver(c.status);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === c.status ? null : o));
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/x-task-id") || dragging;
        setOver(null);
        setDragging(null);
        if (id) setStatus(id, c.status);
      }}
      className={cx(
        "flex min-w-0 flex-col rounded-xl border bg-surface-2/60 transition-colors",
        over === c.status ? "border-accent bg-accent-soft/50" : "border-transparent",
        !phone && "min-h-48",
      )}
    >
      {!phone && (
        <header className="flex items-center gap-2 px-3 pb-1 pt-3 text-sm font-semibold">
          <span aria-hidden className={cx("size-2 rounded-full", DOT[c.status])} />
          {LABEL[c.status]}
          <span className="font-normal text-muted">{c.tasks.length}</span>
        </header>
      )}
      <div className="flex flex-col gap-2 p-2">
        {c.tasks.map((t) => (
          <BoardCard
            key={t.id}
            task={t}
            today={today}
            dragging={dragging === t.id}
            onDragStart={() => setDragging(t.id)}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onStatus={(s) => setStatus(t.id, s)}
          />
        ))}
        {c.tasks.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
            {c.status === "done" ? `Nothing finished in the last ${doneDays} days.` : phone ? "Nothing here." : "Drop tasks here"}
          </p>
        )}
        {c.status === "done" && olderDone > 0 && (
          <Link href={olderDoneHref} className="rounded-lg px-3 py-2 text-center text-xs text-muted hover:bg-surface hover:text-text">
            + {olderDone} done earlier
          </Link>
        )}
      </div>
    </section>
  );

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}
      <p className="sr-only" aria-live="polite">{announce}</p>

      {/* Phone / tablet: one column at a time */}
      <div className="lg:hidden">
        <div className="relative -mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none]">
          <div role="tablist" aria-label="Status" className="inline-flex gap-1 rounded-xl bg-surface-2 p-1">
            {cols.map((c) => {
              const on = mobileCol === c.status;
              return (
                <button
                  key={c.status}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setMobileCol(c.status)}
                  className={cx(
                    "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium",
                    on ? "bg-surface text-text shadow-sm" : "text-muted",
                  )}
                >
                  <span aria-hidden className={cx("size-2 rounded-full", DOT[c.status])} />
                  {LABEL[c.status]}
                  <span className={cx("tabular-nums", on ? "text-muted" : "")}>{c.tasks.length}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div role="tabpanel">{column(cols.find((c) => c.status === mobileCol)!, true)}</div>
      </div>

      {/* Desktop: all five columns */}
      <div className="relative hidden gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-[repeat(5,minmax(12.5rem,1fr))]">{cols.map((c) => column(c, false))}</div>
    </div>
  );
}

function BoardCard({
  task: t, today, dragging, onDragStart, onDragEnd, onStatus,
}: { task: TaskLite; today: string; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onStatus: (s: string) => void }) {
  const done = t.status === "done";
  const overdue = !!t.dueDate && !done && t.dueDate < today;
  const dueToday = !!t.dueDate && !done && t.dueDate === today;
  const initial = t.assignee === "unassigned" ? null : t.assignee[0].toUpperCase();
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-task-id", t.id);
        e.dataTransfer.setData("text/plain", t.title);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cx(
        "group rounded-lg border border-border bg-surface p-3 shadow-sm transition lg:cursor-grab lg:active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <Link href={`/tasks/${t.id}`} draggable={false} className={cx("block break-words text-sm font-medium hover:underline", done && "text-muted line-through")}>
        {t.title}
      </Link>
      {t.clientName && <p className="mt-1 truncate text-xs text-muted">{t.clientName}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <PlatformTag platform={t.platform} />
        {t.dueDate && (
          <span className={cx("text-muted", overdue && "font-semibold text-danger!", dueToday && "font-semibold text-warn!")}>
            {overdue ? "Overdue · " : dueToday ? "Today · " : ""}
            {shortDate(t.dueDate)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {initial && (
            <span title={humanize(t.assignee)} aria-label={`Assigned to ${humanize(t.assignee)}`} className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
              {initial}
            </span>
          )}
        </span>
      </div>
      <label className="mt-2 block">
        <span className="sr-only">Status of “{t.title}”</span>
        <select
          value={t.status}
          onChange={(e) => onStatus(e.currentTarget.value)}
          className="w-full cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted hover:text-text lg:border-transparent lg:bg-surface-2/60 lg:group-hover:border-border pointer-coarse:min-h-11"
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>{LABEL[s]}</option>
          ))}
        </select>
      </label>
    </article>
  );
}
