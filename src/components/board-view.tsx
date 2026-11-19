"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { editTaskField } from "@/app/(app)/tasks/actions";
import { TASK_STATUSES } from "@/lib/schema";
import type { TaskLite } from "./task-table";
import { PlatformTag, Status, cx, humanize, type Tone } from "./ui";

const LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  needs_review: "Needs review",
  blocked: "Blocked",
  done: "Done",
};
const TONE: Record<string, Tone> = {
  todo: "neutral",
  in_progress: "info",
  needs_review: "warn",
  blocked: "danger",
  done: "ok",
};

function shortDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Kanban board. Desktop (lg+): five columns, drag a card to another column (native HTML5 drag & drop),
 * or use the status select on the card. Phone/tablet: one column at a time with underline tabs to switch.
 * Columns are plain lists on hairlines (an ink rule and a caps label on top); a card is a row you can drag.
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
      className={cx("board-col", over === c.status && "is-over")}
    >
      {!phone && (
        <header className="board-head">
          <Status tone={TONE[c.status]} className="eyebrow text-text">{LABEL[c.status]}</Status>
          <span className="num">{c.tasks.length}</span>
        </header>
      )}
      <div className="board-cards">
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
          <p className="meta py-3">
            {c.status === "done" ? `Nothing finished in the last ${doneDays} days.` : phone ? "Nothing here." : "Drop tasks here"}
          </p>
        )}
        {c.status === "done" && olderDone > 0 && (
          <Link href={olderDoneHref} className="board-more">
            + {olderDone} done earlier
          </Link>
        )}
      </div>
    </section>
  );

  return (
    <div>
      {error && (
        <p role="alert" className="notice mb-4">
          <Status tone="danger" className="whitespace-normal">{error}</Status>
        </p>
      )}
      <p className="sr-only" aria-live="polite">{announce}</p>

      {/* Phone / tablet: one column at a time */}
      <div className="lg:hidden">
        <div role="tablist" aria-label="Status" className="tabs board-tabs mb-1">
          {cols.map((c) => {
            const on = mobileCol === c.status;
            return (
              <button key={c.status} type="button" role="tab" aria-selected={on} onClick={() => setMobileCol(c.status)}>
                <Status tone={TONE[c.status]} className="text-inherit">{LABEL[c.status]}</Status>
                <span className="num font-normal text-muted">{c.tasks.length}</span>
              </button>
            );
          })}
        </div>
        <div role="tabpanel">{column(cols.find((c) => c.status === mobileCol)!, true)}</div>
      </div>

      {/* Desktop: all five columns */}
      <div className="board relative hidden lg:grid">{cols.map((c) => column(c, false))}</div>
    </div>
  );
}

function BoardCard({
  task: t, today, dragging, onDragStart, onDragEnd, onStatus,
}: { task: TaskLite; today: string; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onStatus: (s: string) => void }) {
  const done = t.status === "done";
  const overdue = !!t.dueDate && !done && t.dueDate < today;
  const dueToday = !!t.dueDate && !done && t.dueDate === today;
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
      className={cx("board-card", dragging && "is-dragging", done && "is-done")}
    >
      <Link href={`/tasks/${t.id}`} draggable={false} className="row-title tap-target break-words">
        {t.title}
      </Link>
      {/* The facts, a "·" after each; the spaces between them are where the line may break. */}
      <p className="facts-line">
        {t.clientName && <span className="whitespace-normal! break-words">{t.clientName}</span>}{" "}
        {t.platform && (
          <span>
            <PlatformTag platform={t.platform} inherit />
          </span>
        )}{" "}
        {t.assignee !== "unassigned" && <span aria-label={`Assigned to ${humanize(t.assignee)}`}>{humanize(t.assignee)}</span>}{" "}
        {t.dueDate && (
          <span className={cx("due", overdue && "is-over", dueToday && "is-today")}>
            {overdue ? "Overdue · " : dueToday ? "Today · " : ""}
            {shortDate(t.dueDate)}
          </span>
        )}
      </p>
      <label className="block">
        <span className="sr-only">Status of “{t.title}”</span>
        <select value={t.status} onChange={(e) => onStatus(e.currentTarget.value)} className="input board-status">
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>{LABEL[s]}</option>
          ))}
        </select>
      </label>
    </article>
  );
}
