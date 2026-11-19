import { monthLabel } from "@/lib/dates";
import { planGroupProgress, type PlanGroup } from "@/lib/plan-groups";
import { PlanTaskGroup } from "./plan-task-group";
import { TaskRow, isOverdue } from "./task-row";
import { ProgressBar, Tag, cx } from "./ui";

/**
 * Monthly-plan tasks condensed to one collapsible row per plan item:
 *   ›  Instagram feed posts            ▬▬▬▭▭▭▭▭   3 of 8
 * (done of the monthly target; the slots are inside). Groups from another month than the one being looked at
 * carry that month ("From Oct") on a second line. Build `groups` with groupPlanTasks() from lib/plan-groups.
 * Server component; `selectable` passes through to the rows inside a <TaskSelection> (the /tasks bulk bar).
 * `meters={false}` keeps only the words ("3 of 8"): for a page that already draws each plan item's meter (the business
 * page's plan section), so the same progress isn't drawn twice in two styles.
 */
export function PlanTaskGroups({ groups, month, selectable = false, meters = true }: { groups: PlanGroup[]; month: string; selectable?: boolean; meters?: boolean }) {
  if (groups.length === 0) return null;
  return (
    <ul className="list">
      {groups.map((g) => {
        const overdue = g.tasks.filter((t) => isOverdue(t)).length;
        const other = g.month !== month;
        return (
          <li key={g.key}>
            <PlanTaskGroup
              summary={
                <>
                  {/* The hidden "·" keeps the summary reading "Title · 3 of 8" for screen readers and copy-paste. */}
                  <span className="group-title row-title is-plain">
                    {g.title}
                    <span className="sr-only"> ·</span>
                  </span>
                  {meters && g.target > 0 && <ProgressBar value={g.done} max={g.target} />}
                  <span className={cx("meta num n", g.target === 0 && "is-wide")}>{planGroupProgress(g)}</span>
                  {(other || overdue > 0) && (
                    <span className="group-extra meta">
                      {other && <Tag bare>{g.month < month ? `From ${monthLabel(g.month, "short")}` : monthLabel(g.month, "short")}</Tag>}
                      {overdue > 0 && <span className="over">{overdue} overdue</span>}
                    </span>
                  )}
                </>
              }
            >
              <ul className="list group-tasks">
                {g.tasks.map((t) => (
                  <li key={t.id}>
                    <TaskRow task={t} showClient={false} selectable={selectable} />
                  </li>
                ))}
              </ul>
            </PlanTaskGroup>
          </li>
        );
      })}
    </ul>
  );
}
