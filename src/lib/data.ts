import "server-only";
import { asc, desc, eq, and, inArray, isNull, ne, sql } from "drizzle-orm";
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
    db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(and(eq(schema.asks.status, "new"), ne(schema.asks.kind, "idea"))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(and(eq(schema.drafts.status, "needs_review"))),
  ]);
  return { newAsks: asks.n, needsReview: drafts.n };
}

/* ───────────────────────── Nora's creator workspace ───────────────────────── */

/** The one creator workspace (kind "creator"), seeded in drizzle/0005. Stable id. */
export const CREATOR_CLIENT_ID = "noraeatsgood";

export function isCreatorClient(c: { kind?: string | null; id?: string }) {
  return c.kind === "creator";
}

/** Managed businesses only — use where the creator workspace doesn't belong (Google mapping, lead conversion, business grids). */
export async function listBusinesses(opts: { includeArchived?: boolean } = {}) {
  return (await listClients(opts)).filter((c) => !isCreatorClient(c));
}

/** Nora's workspace row, or null if the seed hasn't run. */
export async function getCreatorClient() {
  const db = await getDb();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.kind, "creator")).orderBy(asc(schema.clients.sortOrder)).limit(1);
  return c ?? null;
}

/** Label for client pickers in forms: the creator workspace reads "Nora (own content)"; businesses "Name · Location". */
export function clientOptionLabel(c: { name: string; location: string | null; kind?: string | null }) {
  if (isCreatorClient(c)) return `${c.name} (own content)`;
  return c.location ? `${c.name} · ${c.location}` : c.name;
}

/** Collab requests still waiting on a decision. */
const OPEN_COLLAB = ["new", "reviewing"] as const;

/** Count of collab requests with status "new" (Home card, nav). */
export async function countNewCollabRequests() {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.collabRequests).where(eq(schema.collabRequests.status, "new"));
  return r.n;
}

/** Open (new + reviewing) collab requests: counts and the latest few. */
export async function openCollabRequests(limit = 5) {
  const db = await getDb();
  const cr = schema.collabRequests;
  const [counts, latest] = await Promise.all([
    db.select({ status: cr.status, n: sql<number>`count(*)::int` }).from(cr).where(inArray(cr.status, [...OPEN_COLLAB])).groupBy(cr.status),
    db.select().from(cr).where(inArray(cr.status, [...OPEN_COLLAB])).orderBy(desc(cr.createdAt)).limit(limit),
  ]);
  const by = new Map(counts.map((c) => [c.status, c.n]));
  return { newCount: by.get("new") ?? 0, reviewingCount: by.get("reviewing") ?? 0, latest };
}

/** Collab leads that are in play (qualified → proposal), best first. */
export const COLLAB_LEAD_STAGES = ["qualified", "contacted", "talking", "proposal"] as const;
export async function activeCollabLeads(limit = 5) {
  const db = await getDb();
  const l = schema.leads;
  const where = and(inArray(l.stage, [...COLLAB_LEAD_STAGES]), sql`${l.opportunities} @> '["collab"]'::jsonb`);
  const [rows, [total]] = await Promise.all([
    db.select().from(l).where(where).orderBy(sql`${l.nextStepAt} asc nulls last`, desc(l.updatedAt)).limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(l).where(where),
  ]);
  return { rows, total: total.n };
}

/** Nora's own open tasks with no business attached (her content work that wasn't filed under her workspace). Up to `month`. */
export async function noraUnfiledTasks(month: string) {
  const db = await getDb();
  const t = schema.tasks;
  return db
    .select()
    .from(t)
    .where(and(eq(t.assignee, "nora"), isNull(t.clientId), ne(t.status, "done"), sql`${t.month} <= ${month}`))
    .orderBy(sql`${t.dueDate} asc nulls last`, asc(t.createdAt))
    .limit(50);
}
