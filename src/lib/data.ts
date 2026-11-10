import "server-only";
import { asc, eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "./db";

/** Small shared read helpers used across pages. Module-specific queries live next to their pages. */

export async function listClients(opts: { includeArchived?: boolean } = {}) {
  const db = await getDb();
  return db
    .select()
    .from(schema.clients)
    .where(opts.includeArchived ? undefined : eq(schema.clients.archived, false))
    .orderBy(asc(schema.clients.sortOrder), asc(schema.clients.name));
}

export async function getClient(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  return c ?? null;
}

/** Counts for nav badges. */
export async function navCounts() {
  const db = await getDb();
  const [[asks], [drafts]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(eq(schema.asks.status, "new")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(and(eq(schema.drafts.status, "needs_review"))),
  ]);
  return { newAsks: asks.n, needsReview: drafts.n };
}
