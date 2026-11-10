import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { addMonths, lastMonths } from "./dates";

/**
 * Read model for one business in one month. Used by the business page, the home overview
 * and the Claude connector (get_client_month), so every surface shows the same numbers.
 *
 * Progress rule: a deliverable's progress = tasks linked to it for that month with status "done".
 */
export async function getClientMonth(clientId: string, month: string) {
  const db = await getDb();
  const monthStart = new Date(`${month}-01T00:00:00Z`);
  const nextStart = new Date(`${addMonths(month, 1)}-01T00:00:00Z`);

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!client) return null;

  const [deliverables, monthTasks, openTasks, outreachRows, metrics, posts, unreplied, pendingDrafts] = await Promise.all([
    db.select().from(schema.deliverables).where(eq(schema.deliverables.clientId, clientId)).orderBy(asc(schema.deliverables.sortOrder)),
    db.select().from(schema.tasks).where(and(eq(schema.tasks.clientId, clientId), eq(schema.tasks.month, month))),
    // Outstanding = anything not done for this client up to and including this month (overdue carries forward).
    db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.clientId, clientId), ne(schema.tasks.status, "done"), sql`${schema.tasks.month} <= ${month}`))
      .orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)),
    db.select({ o: schema.outreach, c: schema.creators }).from(schema.outreach)
      .innerJoin(schema.creators, eq(schema.outreach.creatorId, schema.creators.id))
      .where(eq(schema.outreach.clientId, clientId))
      .orderBy(desc(schema.outreach.lastActivityAt)),
    db.select().from(schema.monthlyMetrics)
      .where(and(eq(schema.monthlyMetrics.clientId, clientId), inArray(schema.monthlyMetrics.month, lastMonths(12, month)))),
    db.select().from(schema.contentPosts)
      .where(and(eq(schema.contentPosts.clientId, clientId), gte(schema.contentPosts.scheduledFor, monthStart), lt(schema.contentPosts.scheduledFor, nextStart)))
      .orderBy(asc(schema.contentPosts.scheduledFor)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.reviews).where(and(eq(schema.reviews.clientId, clientId), isNull(schema.reviews.replyText))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(and(eq(schema.drafts.clientId, clientId), eq(schema.drafts.status, "needs_review"))),
  ]);

  const plan = deliverables.filter((d) => d.active).map((d) => {
    const linked = monthTasks.filter((t) => t.deliverableId === d.id);
    return { deliverable: d, done: linked.filter((t) => t.status === "done").length, planned: linked.length, target: d.targetPerMonth };
  });

  const inMonth = (dt: Date | null) => !!dt && dt >= monthStart && dt < nextStart;
  const contactedThisMonth = outreachRows.filter((r) => inMonth(r.o.contactedAt));

  const months = lastMonths(12, month);
  const series = months.map((m) => {
    const rows = metrics.filter((x) => x.month === m);
    const get = (p: string) => rows.find((x) => x.platform === p) ?? null;
    return { month: m, instagram: get("instagram"), tiktok: get("tiktok"), google: get("google") };
  });

  return {
    client,
    month,
    plan,
    monthTasks,
    openTasks,
    outreach: outreachRows.map((r) => ({ ...r.o, creator: r.c })),
    contactedThisMonth: contactedThisMonth.length,
    metrics: series,
    posts,
    unrepliedReviews: unreplied[0].n,
    pendingDrafts: pendingDrafts[0].n,
  };
}

export type ClientMonth = NonNullable<Awaited<ReturnType<typeof getClientMonth>>>;
