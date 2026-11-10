import "server-only";
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { monthBounds } from "@/lib/integrations/time";

/**
 * Light per-business summary for the /clients list (one query per table, not per business).
 * Progress uses the same rule as getClientMonth: done tasks linked to a deliverable this month,
 * capped at each deliverable's target. "As needed" (target 0) items don't count toward the %.
 */
export async function clientSummaries(clientIds: string[], month: string) {
  if (clientIds.length === 0) return new Map<string, Summary>();
  const db = await getDb();
  // Month edges in the app timezone (America/New_York), matching the calendar and Instagram insights.
  const { start: monthStart, end: nextStart } = monthBounds(month);

  const [dels, doneRows, openRows, contacted] = await Promise.all([
    db.select().from(schema.deliverables).where(and(inArray(schema.deliverables.clientId, clientIds), eq(schema.deliverables.active, true))),
    db.select({ deliverableId: schema.tasks.deliverableId, n: sql<number>`count(*)::int` }).from(schema.tasks)
      .where(and(inArray(schema.tasks.clientId, clientIds), eq(schema.tasks.month, month), eq(schema.tasks.status, "done")))
      .groupBy(schema.tasks.deliverableId),
    db.select({ clientId: schema.tasks.clientId, n: sql<number>`count(*)::int` }).from(schema.tasks)
      .where(and(inArray(schema.tasks.clientId, clientIds), ne(schema.tasks.status, "done"), sql`${schema.tasks.month} <= ${month}`))
      .groupBy(schema.tasks.clientId),
    db.select({ clientId: schema.outreach.clientId, n: sql<number>`count(*)::int` }).from(schema.outreach)
      .where(and(inArray(schema.outreach.clientId, clientIds), gte(schema.outreach.contactedAt, monthStart), lt(schema.outreach.contactedAt, nextStart)))
      .groupBy(schema.outreach.clientId),
  ]);

  const doneBy = new Map(doneRows.map((r) => [r.deliverableId, r.n]));
  const out = new Map<string, Summary>();
  for (const id of clientIds) out.set(id, { done: 0, target: 0, open: 0, contacted: 0, items: 0 });
  for (const dl of dels) {
    const s = out.get(dl.clientId)!;
    s.items++;
    if (dl.targetPerMonth > 0) {
      s.target += dl.targetPerMonth;
      s.done += Math.min(dl.targetPerMonth, doneBy.get(dl.id) ?? 0);
    }
  }
  for (const r of openRows) if (r.clientId && out.has(r.clientId)) out.get(r.clientId)!.open = r.n;
  for (const r of contacted) if (out.has(r.clientId)) out.get(r.clientId)!.contacted = r.n;
  return out;
}

export type Summary = { done: number; target: number; open: number; contacted: number; items: number };

export async function listDeliverables(clientId: string) {
  const db = await getDb();
  return db.select().from(schema.deliverables).where(eq(schema.deliverables.clientId, clientId)).orderBy(schema.deliverables.sortOrder);
}
