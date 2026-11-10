import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { addMonths } from "./dates";
import { logActivity } from "./activity";
import { OpsError } from "./ops";

/**
 * Bulk task mutations (the /tasks bulk action bar). Same conventions as lib/ops:
 * zod-validated input, `actor` is a user email or "claude", one activity entry per call.
 */

const Ids = z.array(z.string().min(1)).min(1, "Pick at least one task").max(200, "At most 200 tasks at a time");

export const BulkTaskPatch = z
  .object({
    status: z.enum(schema.TASK_STATUSES).optional(),
    assignee: z.enum(schema.ASSIGNEES).optional(),
    /** Push the tasks into the next month: month +1 and the due date (if any) +1 month. */
    nextMonth: z.literal(true).optional(),
  })
  .refine((p) => p.status !== undefined || p.assignee !== undefined || p.nextMonth, "Nothing to change");

/** "2026-01-31" + 1 month → "2026-02-28" (clamped to the month's last day). */
export function shiftDateByMonths(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = addMonths(`${y}-${String(m).padStart(2, "0")}`, delta);
  const [ty, tm] = target.split("-").map(Number);
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${target}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const plural = (n: number) => `${n} task${n === 1 ? "" : "s"}`;

async function logBulk(actor: string, rows: Array<{ id: string; clientId: string | null; title: string }>, summary: string) {
  if (rows.length === 0) return;
  const clientIds = new Set(rows.map((r) => r.clientId));
  const single = rows.length === 1 ? rows[0] : null;
  await logActivity({
    actor,
    action: "task.bulk_updated",
    entityType: single ? "task" : "tasks",
    entityId: single ? single.id : newId("bulk_"),
    clientId: clientIds.size === 1 ? [...clientIds][0] : null,
    summary,
  });
}

export async function bulkUpdateTasks(ids: string[], patch: z.input<typeof BulkTaskPatch>, actor: string) {
  const list = [...new Set(Ids.parse(ids))];
  const v = BulkTaskPatch.parse(patch);
  const db = await getDb();
  const rows = await db.select().from(schema.tasks).where(inArray(schema.tasks.id, list));
  if (rows.length === 0) throw new OpsError("Those tasks no longer exist");

  const base: Partial<typeof schema.tasks.$inferInsert> = {};
  if (v.assignee) base.assignee = v.assignee;
  if (v.status) {
    base.status = v.status;
    base.completedAt = v.status === "done" ? new Date() : null;
  }

  if (v.nextMonth) {
    // Month and due date differ per row, so update one at a time (≤200 rows).
    for (const r of rows) {
      await db
        .update(schema.tasks)
        .set({
          ...base,
          // Keep the original completion time for tasks that were already done.
          ...(v.status === "done" && r.status === "done" ? { completedAt: r.completedAt } : {}),
          month: addMonths(r.month, 1),
          dueDate: r.dueDate ? shiftDateByMonths(r.dueDate, 1) : null,
        })
        .where(eq(schema.tasks.id, r.id));
    }
  } else if (v.status === "done") {
    // Don't reset completedAt on tasks that were already done.
    const open = rows.filter((r) => r.status !== "done").map((r) => r.id);
    const done = rows.filter((r) => r.status === "done").map((r) => r.id);
    if (open.length) await db.update(schema.tasks).set(base).where(inArray(schema.tasks.id, open));
    const { status: _s, completedAt: _c, ...rest } = base;
    if (done.length && Object.keys(rest).length) await db.update(schema.tasks).set(rest).where(inArray(schema.tasks.id, done));
  } else {
    await db.update(schema.tasks).set(base).where(inArray(schema.tasks.id, rows.map((r) => r.id)));
  }

  const parts: string[] = [];
  if (v.status) parts.push(v.status === "done" ? "marked done" : `set to ${v.status.replace(/_/g, " ")}`);
  if (v.assignee) parts.push(v.assignee === "unassigned" ? "unassigned" : `assigned to ${v.assignee[0].toUpperCase()}${v.assignee.slice(1)}`);
  if (v.nextMonth) parts.push("moved to next month");
  const what = parts.join(", ");
  const summary = rows.length === 1 ? `Task “${rows[0].title}” ${what}` : `${plural(rows.length)} ${what}`;
  await logBulk(actor, rows, summary);
  return rows.length;
}

export async function bulkDeleteTasks(ids: string[], actor: string) {
  const list = [...new Set(Ids.parse(ids))];
  const db = await getDb();
  const rows = await db.delete(schema.tasks).where(inArray(schema.tasks.id, list)).returning();
  await logBulk(actor, rows, rows.length === 1 ? `Deleted task “${rows[0].title}”` : `Deleted ${plural(rows.length)}`);
  return rows.length;
}
