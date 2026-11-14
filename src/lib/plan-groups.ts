import "server-only";
import { and, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { Platform, Task } from "./schema";

/**
 * Monthly-plan tasks ("Instagram feed posts — 3 of 8", … one per slot) condensed into one group per plan item per
 * month, so a list shows "Instagram feed posts · 3 of 8 ▸" instead of eight near-identical rows.
 * Used by /tasks and the business page (rendered by components/plan-task-groups).
 */

export type PlanGroup = {
  /** `${deliverableId}:${month}` */
  key: string;
  clientId: string | null;
  deliverableId: string;
  month: string;
  /** The plan item's title, e.g. "Instagram feed posts / reels". */
  title: string;
  platform: Platform | null;
  /** Per month; 0 = "as needed". */
  target: number;
  /** Tasks for this plan item in this month that are done / that exist (whatever the list's filters hide). */
  done: number;
  planned: number;
  /** The tasks that were passed in, in the order given. */
  tasks: Task[];
};

/** A generated (or hand-linked) monthly-plan slot. Ad hoc tasks and the Getting started steps have no plan item. */
export function isPlanTask(t: Pick<Task, "deliverableId">): boolean {
  return !!t.deliverableId;
}

/** "3 of 8", or "2 done · as needed" for plan items with no monthly number. */
export function planGroupProgress(g: Pick<PlanGroup, "done" | "target">): string {
  return g.target > 0 ? `${g.done} of ${g.target}` : `${g.done} done · as needed`;
}

/**
 * Groups the plan tasks in `tasks` (others are ignored) by plan item and month, with each group's real progress.
 * Ordered like the plan (the business's own item order), newest month first within an item.
 */
export async function groupPlanTasks(tasks: Task[]): Promise<PlanGroup[]> {
  const planTasks = tasks.filter(isPlanTask);
  if (planTasks.length === 0) return [];
  const ids = [...new Set(planTasks.map((t) => t.deliverableId!))];
  const months = [...new Set(planTasks.map((t) => t.month))];
  const db = await getDb();
  const [dels, counts] = await Promise.all([
    db.select().from(schema.deliverables).where(inArray(schema.deliverables.id, ids)),
    db
      .select({
        deliverableId: schema.tasks.deliverableId,
        month: schema.tasks.month,
        planned: sql<number>`count(*)::int`,
        done: sql<number>`(count(*) filter (where ${schema.tasks.status} = 'done'))::int`,
      })
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.deliverableId, ids), inArray(schema.tasks.month, months)))
      .groupBy(schema.tasks.deliverableId, schema.tasks.month),
  ]);
  const byId = new Map(dels.map((d) => [d.id, d]));
  const countOf = new Map(counts.map((c) => [`${c.deliverableId}:${c.month}`, c]));

  const groups = new Map<string, PlanGroup>();
  for (const t of planTasks) {
    const key = `${t.deliverableId}:${t.month}`;
    let g = groups.get(key);
    if (!g) {
      const d = byId.get(t.deliverableId!);
      const c = countOf.get(key);
      g = {
        key, clientId: d?.clientId ?? t.clientId, deliverableId: t.deliverableId!, month: t.month,
        // The row can only be missing in a race with a plan edit; fall back to the task's own words.
        title: d?.title ?? t.title.replace(/\s+—\s+\d+ of \d+$/, ""),
        platform: d?.platform ?? t.platform, target: d?.targetPerMonth ?? 0,
        done: c?.done ?? 0, planned: c?.planned ?? 0, tasks: [],
      };
      groups.set(key, g);
    }
    g.tasks.push(t);
  }
  const order = (g: PlanGroup) => byId.get(g.deliverableId)?.sortOrder ?? 999;
  return [...groups.values()].sort(
    (a, b) => (a.clientId ?? "").localeCompare(b.clientId ?? "") || order(a) - order(b) || a.title.localeCompare(b.title) || b.month.localeCompare(a.month),
  );
}
