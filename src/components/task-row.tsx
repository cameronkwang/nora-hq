import Link from "next/link";
import { Children, isValidElement } from "react";
import { toggleTaskDone } from "@/app/(app)/tasks/actions";
import { formatDate, today } from "@/lib/dates";
import type { Task } from "@/lib/schema";
import { TaskToggleButton } from "./task-toggle";
import { TaskSelectBox } from "./task-selection";
import { PlatformTag, StatusBadge, cx, humanize } from "./ui";

export function isOverdue(task: Pick<Task, "dueDate" | "status">, now = today()) {
  return !!task.dueDate && task.status !== "done" && task.dueDate < now;
}

/**
 * One task as a row: the done tick, then one link to the edit page: the title with its small facts (platform, who,
 * state) after it, then the business and the due date. Wide: the business and the date sit in fixed columns (see
 * .task-link in calendar-tasks.css). Narrow: the title line, then one meta line joined by "·".
 * Server component; the tick posts to toggleTaskDone and revalidates every page.
 * `selectable`: shows a bulk-select checkbox when the row sits inside a <TaskSelection> that is selecting.
 * Put it in a `ul.list > li` (or <TaskList>, which does that).
 */
export function TaskRow({ task, clientName, showClient = true, selectable = false }: { task: Task; clientName?: string | null; showClient?: boolean; selectable?: boolean }) {
  const done = task.status === "done";
  const overdue = isOverdue(task);
  const dueToday = !!task.dueDate && task.dueDate === today() && !done;
  const hasNotes = !!task.platform || task.assignee !== "unassigned" || (task.status !== "todo" && !done);

  return (
    <div className={cx("row task-row", done && "is-done")}>
      {selectable && <TaskSelectBox id={task.id} title={task.title} />}
      <form action={toggleTaskDone}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="done" value={done ? "0" : "1"} />
        <TaskToggleButton done={done} title={task.title} />
      </form>

      <Link href={`/tasks/${task.id}`} className={cx("task-link", !showClient && "no-where")}>
        {/* The title, then its small facts flowing after it like one sentence. */}
        <span className="task-main">
          <span className="row-title">{task.title}</span>
          {hasNotes && (
            <span className="task-notes">
              {/* Spaces between the facts are where a line may break; each fact's "·" stays on the line before. */}
              {task.platform && (
                <span>
                  <PlatformTag platform={task.platform} inherit />
                </span>
              )}{" "}
              {task.assignee !== "unassigned" && <span>{humanize(task.assignee)}</span>}{" "}
              {task.status !== "todo" && !done && (
                <span>
                  <StatusBadge status={task.status} />
                </span>
              )}
            </span>
          )}
        </span>
        <span className="row-meta">
          {showClient && clientName && <span className="meta where">{clientName}</span>}
          {task.dueDate && (
            <span className={cx("due when", overdue && "is-over", dueToday && "is-today")}>
              {overdue ? `Overdue · ${formatDate(task.dueDate)}` : dueToday ? "Due today" : `Due ${formatDate(task.dueDate)}`}
            </span>
          )}
        </span>
      </Link>
    </div>
  );
}

/** A list of task rows on hairlines. Each child becomes one `li`. */
export function TaskList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list">
      {Children.map(children, (c) => (isValidElement(c) ? <li>{c}</li> : null))}
    </ul>
  );
}
