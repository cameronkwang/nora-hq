import "server-only";
import { and, desc, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type ReviewFilters = { client?: string; show: "unreplied" | "all"; rating?: number };
export const PAGE_SIZE = 100;

export async function listReviews(f: ReviewFilters) {
  const db = await getDb();
  const r = schema.reviews;
  const where: SQL[] = [eq(schema.clients.archived, false)];
  if (f.client) where.push(eq(r.clientId, f.client));
  if (f.show === "unreplied") where.push(isNull(r.replyText));
  if (f.rating) where.push(eq(r.rating, f.rating));
  return db
    .select({ review: r, clientName: schema.clients.name, clientLocation: schema.clients.location })
    .from(r)
    .innerJoin(schema.clients, eq(schema.clients.id, r.clientId))
    .where(and(...where))
    .orderBy(sql`${r.createTime} desc nulls last`)
    .limit(PAGE_SIZE + 1);
}

export async function reviewStats(client?: string) {
  const db = await getDb();
  const r = schema.reviews;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unreplied: sql<number>`count(*) filter (where ${r.replyText} is null)::int`,
      avg: sql<number | null>`round(avg(${r.rating})::numeric, 1)::float`,
      lastSync: sql<Date | null>`max(${r.syncedAt})`,
    })
    .from(r)
    .innerJoin(schema.clients, eq(schema.clients.id, r.clientId))
    .where(and(eq(schema.clients.archived, false), client ? eq(r.clientId, client) : undefined));
  return { ...row, lastSync: row.lastSync ? new Date(row.lastSync) : null };
}

/** Open review_reply drafts keyed by meta.reviewId. */
export async function draftsForReviews(reviewIds: string[]) {
  const map = new Map<string, { id: string; status: string }>();
  if (reviewIds.length === 0) return map;
  const db = await getDb();
  const d = schema.drafts;
  const rows = await db
    .select({ id: d.id, status: d.status, reviewId: sql<string>`${d.meta}->>'reviewId'` })
    .from(d)
    .where(and(eq(d.kind, "review_reply"), inArray(d.status, ["needs_review", "approved", "failed", "rejected"]), inArray(sql<string>`${d.meta}->>'reviewId'`, reviewIds)))
    .orderBy(desc(d.createdAt));
  for (const row of rows) if (!map.has(row.reviewId)) map.set(row.reviewId, { id: row.id, status: row.status });
  return map;
}

/** Asks already filed for these reviews (body mentions the review id) that Claude hasn't finished. */
export async function openAsksForReviews(reviewIds: string[]) {
  const set = new Map<string, string>();
  if (reviewIds.length === 0) return set;
  const db = await getDb();
  const a = schema.asks;
  const rows = await db
    .select({ id: a.id, body: a.body })
    .from(a)
    .where(and(inArray(a.status, ["new", "in_progress"]), or(...reviewIds.map((id) => like(a.body, `%${id.replace(/[%_\\]/g, "")}%`)))));
  for (const row of rows) for (const id of reviewIds) if (row.body.includes(id)) set.set(id, row.id);
  return set;
}
