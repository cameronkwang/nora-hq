import Link from "next/link";
import { toggleTaskDone } from "@/app/(app)/tasks/actions";
import { formatDate, today } from "@/lib/dates";
import type { Task } from "@/lib/schema";
import { TaskToggleButton } from "./task-toggle";
import { PlatformTag, StatusBadge, cx, humanize } from "./ui";

export function isOverdue(task: Pick<Task, "dueDate" | "status">, now = today()) {
  return !!task.dueDate && task.status !== "done" && task.dueDate < now;
}

/**
 * One task as a row: done toggle, title (links to the edit page), and a meta line.
 * Server component; the toggle posts to toggleTaskDone and revalidates every page.
 */
export function TaskRow({ task, clientName, showClient = true }: { task: Task; clientName?: string | null; showClient?: boolean }) {
  const done = task.status === "done";
  const overdue = isOverdue(task);
  const dueToday = !!task.dueDate && task.dueDate === today() && !done;

  return (
    <div className="flex items-start gap-3 py-3">
      <form action={toggleTaskDone} className="pt-0.5">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="done" value={done ? "0" : "1"} />
        <TaskToggleButton done={done} title={task.title} />
      </form>

      <div className="min-w-0 flex-1">
        <Link href={`/tasks/${task.id}`} className={cx("block break-words text-sm font-medium hover:underline", done && "text-muted line-through")}>
          {task.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {showClient && clientName && <span className="max-w-full truncate">{clientName}</span>}
          <PlatformTag platform={task.platform} />
          {task.assignee !== "unassigned" && <span>{humanize(task.assignee)}</span>}
          {task.dueDate && (
            <span className={cx(overdue && "font-semibold text-danger", dueToday && "font-semibold text-warn")}>
              {overdue ? "Overdue · " : dueToday ? "Due today · " : "Due "}
              {formatDate(task.dueDate)}
            </span>
          )}
        </div>
      </div>

      {task.status !== "todo" && !done && (
        <div className="shrink-0">
          <StatusBadge status={task.status} />
        </div>
      )}
    </div>
  );
}

/** Divided list wrapper so callers get consistent spacing. */
export function TaskList({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}
