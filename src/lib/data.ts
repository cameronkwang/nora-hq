import "server-only";
import { asc, desc, eq, and, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { addMonths, currentMonth, monthLabel, today } from "./dates";
import { findConnection } from "./integrations/connections";
import { monthBounds } from "./integrations/time";
import { googleSyncInfo, googleSyncSentence } from "./google-status";
import { hasSecret } from "./credential-guard";
import { launchInfo } from "./launch";

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

/**
 * Counts for nav badges.
 * - newAsks: open asks nobody has picked up (ideas excluded)
 * - needsReview: drafts waiting for approval
 * - tasksDue: open tasks due today or earlier — the viewer's own when `assignee` is given, else everyone's (Claude's excluded)
 */
export async function navCounts(opts: { assignee?: string } = {}) {
  const db = await getDb();
  const t = schema.tasks;
  const who = opts.assignee ? eq(t.assignee, opts.assignee as schema.Assignee) : ne(t.assignee, "claude");
  const [[asks], [drafts], [due]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(and(eq(schema.asks.status, "new"), ne(schema.asks.kind, "idea"))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(and(eq(schema.drafts.status, "needs_review"))),
    db.select({ n: sql<number>`count(*)::int` }).from(t).where(and(ne(t.status, "done"), who, isNotNull(t.dueDate), lte(t.dueDate, today()))),
  ]);
  return { newAsks: asks.n, needsReview: drafts.n, tasksDue: due.n };
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

/* ───────────────────────── Client health (Home strip) ───────────────────────── */

export type HealthTone = "danger" | "warn" | "info" | "ok";

/** One business on Home's health strip: its single worst issue (or "All good") and where to fix it. */
export type ClientHealthRow = {
  clientId: string;
  name: string;
  location: string | null;
  tone: HealthTone;
  issue: string;
  href: string;
  /** How many other issues sit behind the one shown. */
  more: number;
};

/** A sent onboarding form counts as "not returned" after this many days (same wait as Claude's briefing nudge). */
const FORM_NUDGE_DAYS = 3;
/** Last month's report counts as "not sent" from this day of the month (the first week is when it gets drafted). */
const REPORT_DUE_DAY = 8;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Home's health strip: one row per active business (Nora's own workspace is left out) with its worst issue.
 * Issues are checked worst-first; the first one that applies is shown, the rest are counted in `more`:
 *   a password in the notes → Google sync failing → Google not linked → Google shows 0 reviews →
 *   reviews unanswered → tasks overdue → last month's report not sent → owner form not returned →
 *   Google never / not lately synced → opening soon (pre-launch).
 * A business that isn't open yet (pre-launch, opening day still ahead: the same rule as lib/launch) skips the
 * Google-listing and report checks; with no Google account connected at all, the Google checks are skipped for
 * everyone (that's one setup step in Settings, not a per-client problem).
 */
export async function clientHealth(now = new Date()): Promise<ClientHealthRow[]> {
  const businesses = await listBusinesses();
  if (businesses.length === 0) return [];
  const db = await getDb();
  const ids = businesses.map((b) => b.id);
  const day = today(now);
  const month = currentMonth(now);
  const lastMonth = addMonths(month, -1);
  const reportDue = Number(day.slice(8, 10)) >= REPORT_DUE_DAY;
  const n = sql<number>`count(*)::int`;

  const [googleConnected, unreplied, overdue, sentReports, intakes] = await Promise.all([
    findConnection("google", null).then((c) => !!c, () => false),
    db.select({ clientId: schema.reviews.clientId, n }).from(schema.reviews)
      .where(and(inArray(schema.reviews.clientId, ids), isNull(schema.reviews.replyText))).groupBy(schema.reviews.clientId),
    db.select({ clientId: schema.tasks.clientId, n }).from(schema.tasks)
      .where(and(inArray(schema.tasks.clientId, ids), ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lt(schema.tasks.dueDate, day)))
      .groupBy(schema.tasks.clientId),
    reportDue
      ? db.select({ clientId: schema.clientReports.clientId }).from(schema.clientReports)
          .where(and(inArray(schema.clientReports.clientId, ids), eq(schema.clientReports.month, lastMonth), eq(schema.clientReports.audience, "external"), eq(schema.clientReports.status, "sent")))
      : Promise.resolve([] as { clientId: string }[]),
    db.select({ clientId: schema.clientIntakes.clientId, status: schema.clientIntakes.status, createdAt: schema.clientIntakes.createdAt, expiresAt: schema.clientIntakes.expiresAt })
      .from(schema.clientIntakes).where(inArray(schema.clientIntakes.clientId, ids)).orderBy(desc(schema.clientIntakes.createdAt)),
  ]);

  const unrepliedBy = new Map(unreplied.map((r) => [r.clientId, r.n]));
  const overdueBy = new Map(overdue.map((r) => [r.clientId, r.n]));
  const reportSent = new Set(sentReports.map((r) => r.clientId));
  const latestIntake = new Map<string, (typeof intakes)[number]>();
  for (const r of intakes) if (!latestIntake.has(r.clientId)) latestIntake.set(r.clientId, r);
  const lastMonthEnd = monthBounds(month).start;
  const formNudgeBefore = now.getTime() - FORM_NUDGE_DAYS * 86_400_000;

  return businesses.map((c) => {
    type Issue = { tone: HealthTone; issue: string; href: string };
    const issues: Issue[] = [];
    const page = `/clients/${c.id}`;
    const google = googleSyncInfo(c, googleConnected, now);
    const launch = launchInfo(c, day);
    const googleIssue = (tone: HealthTone, href: string): Issue => ({ tone, issue: googleSyncSentence(google), href });

    if (hasSecret(c.notes) || hasSecret(c.brandVoice)) issues.push({ tone: "danger", issue: "Password saved in notes", href: `${page}/settings` });
    // Google is per business only once the account is connected; with no account it's one setup step, not every client's problem.
    if (googleConnected) {
      if (google.state === "error") issues.push(googleIssue("danger", "/settings#google"));
      if (google.state === "unlinked" && !launch.planOnHold) issues.push(googleIssue("warn", "/settings#google-locations"));
      if (google.state === "empty") issues.push(googleIssue("warn", "/settings#google-locations"));
    }

    const reviews = unrepliedBy.get(c.id) ?? 0;
    if (reviews > 0) issues.push({ tone: "warn", issue: count(reviews, "review unanswered", "reviews unanswered"), href: `/reviews?client=${encodeURIComponent(c.id)}` });
    const late = overdueBy.get(c.id) ?? 0;
    if (late > 0) issues.push({ tone: "warn", issue: count(late, "task overdue", "tasks overdue"), href: `/tasks?client=${encodeURIComponent(c.id)}&scope=all` });

    // Only for a business we were already working with (and open) last month.
    if (reportDue && !launch.prelaunch && c.createdAt < lastMonthEnd && !reportSent.has(c.id)) {
      issues.push({ tone: "warn", issue: `${monthLabel(lastMonth, "short").split(" ")[0]} report not sent`, href: `/reports?client=${encodeURIComponent(c.id)}&month=${lastMonth}` });
    }

    const form = latestIntake.get(c.id);
    if (form && (form.status === "sent" || form.status === "opened") && form.createdAt.getTime() < formNudgeBefore && (!form.expiresAt || form.expiresAt.getTime() > now.getTime())) {
      issues.push({ tone: "warn", issue: "Owner form not returned", href: page });
    }

    if (googleConnected && (google.state === "never" || (google.state === "ok" && google.stale))) issues.push(googleIssue("warn", "/settings#google"));

    if (launch.prelaunch) {
      const days = launch.daysToOpening;
      if (days == null) issues.push({ tone: "info", issue: "Pre-launch · no opening date yet", href: `${page}/settings#launch` });
      else if (days < 0) issues.push({ tone: "warn", issue: "Opening date has passed · still marked pre-launch", href: `${page}/settings#launch` });
      else issues.push({ tone: days <= 7 ? "warn" : "info", issue: days === 0 ? "Opening today" : days === 1 ? "Opening tomorrow" : `Opening in ${days} days`, href: page });
    }

    const worst = issues[0] ?? { tone: "ok" as const, issue: "All good", href: page };
    return { clientId: c.id, name: c.name, location: c.location, ...worst, more: Math.max(0, issues.length - 1) };
  });
}
