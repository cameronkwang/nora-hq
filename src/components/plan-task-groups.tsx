import { monthLabel } from "@/lib/dates";
import { planGroupProgress, type PlanGroup } from "@/lib/plan-groups";
import { PlanTaskGroup } from "./plan-task-group";
import { TaskRow, isOverdue } from "./task-row";
import { Badge } from "./ui";

/**
 * Monthly-plan tasks condensed to one collapsible row per plan item:
 *   Instagram feed posts · 3 of 8 ▸
 * (done of the monthly target; the slots are inside). Groups from another month than the one being looked at
 * carry that month ("From Oct"). Build `groups` with groupPlanTasks() from lib/plan-groups.
 * Server component; `selectable` passes through to the rows inside a <TaskSelection> (the /tasks bulk bar).
 */
export function PlanTaskGroups({ groups, month, selectable = false }: { groups: PlanGroup[]; month: string; selectable?: boolean }) {
  if (groups.length === 0) return null;
  return (
    <ul className="divide-y divide-border">
      {groups.map((g) => {
        const overdue = g.tasks.filter((t) => isOverdue(t)).length;
        return (
          <li key={g.key}>
            <PlanTaskGroup
              summary={
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="min-w-0 break-words text-sm font-medium">{g.title}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted">· {planGroupProgress(g)}</span>
                  {g.month !== month && (
                    <Badge tone={g.month < month ? "warn" : "neutral"}>{g.month < month ? `From ${monthLabel(g.month, "short")}` : monthLabel(g.month, "short")}</Badge>
                  )}
                  {overdue > 0 && <span className="shrink-0 text-xs font-medium text-danger">{overdue} overdue</span>}
                </span>
              }
            >
              <div className="divide-y divide-border border-t border-border pl-2">
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} showClient={false} selectable={selectable} />
                ))}
              </div>
            </PlanTaskGroup>
          </li>
        );
      })}
    </ul>
  );
}
