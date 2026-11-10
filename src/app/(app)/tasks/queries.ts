import "server-only";
import { and, asc, desc, eq, gte, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assigneeFor } from "@/lib/auth";
import { isMonth } from "@/lib/dates";
import type { SessionUser } from "@/lib/session";
import { ASSIGNEES, TASK_STATUSES, type Task } from "@/lib/schema";

/** Shared by /tasks, /tasks/export: one parser for the URL so every view filters the same way. */

export const VIEWS = ["list", "board", "table"] as const;
export type View = (typeof VIEWS)[number];
export const SORT_KEYS = ["title", "business", "status", "assignee", "due", "platform", "month"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type TaskFilters = {
  client: string; // "" | client id | "none"
  assignee: string; // "" | "me" | an ASSIGNEES value
  status: string; // "open" (default, not done) | "all" | a TASK_STATUSES value
  month: string; // "" | YYYY-MM
  group: "due" | "business";
  view: View;
  sort: SortKey;
  dir: "asc" | "desc";
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export const viewCookieName = (user: SessionUser) => `tasks_view_${assigneeFor(user).replace(/[^a-z0-9]/g, "")}`;

export function parseTaskFilters(sp: SP | URLSearchParams, cookieView?: string): TaskFilters {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? "") : one(sp[k]));
  const v = get("view") || cookieView || "";
  const assignee = get("assignee");
  const status = get("status");
  const sort = get("sort");
  return {
    client: get("client"),
    assignee: assignee === "me" || (ASSIGNEES as readonly string[]).includes(assignee) ? assignee : "",
    status: status === "all" || (TASK_STATUSES as readonly string[]).includes(status) ? status : "open",
    month: isMonth(get("month")) ? get("month") : "",
    group: get("group") === "business" ? "business" : "due",
    view: (VIEWS as readonly string[]).includes(v) ? (v as View) : "list",
    sort: (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : "due",
    dir: get("dir") === "desc" ? "desc" : "asc",
  };
}

/** URL for /tasks (or another base) with the current filters plus a patch. Defaults are left out. */
export function tasksHref(f: TaskFilters, patch: Partial<Record<keyof TaskFilters, string>> = {}, base = "/tasks") {
  const cur: Record<string, string> = {
    // Always explicit: the remembered view (cookie) must not override a link's view.
    view: base === "/tasks" ? f.view : "",
    client: f.client,
    assignee: f.assignee,
    status: f.status === "open" ? "" : f.status,
    month: f.month,
    group: f.group === "due" ? "" : f.group,
    sort: f.sort === "due" ? "" : f.sort,
    dir: f.dir === "asc" ? "" : f.dir,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v && !(k === "status" && v === "open")) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function isFiltered(f: TaskFilters) {
  return !!(f.client || f.assignee || f.status !== "open" || f.month);
}

function baseWhere(f: TaskFilters, user: SessionUser, withStatus: boolean): SQL[] {
  const where: SQL[] = [];
  if (f.client === "none") where.push(isNull(schema.tasks.clientId));
  else if (f.client) where.push(eq(schema.tasks.clientId, f.client));
  const who = f.assignee === "me" ? assigneeFor(user) : f.assignee;
  if (who && (ASSIGNEES as readonly string[]).includes(who)) where.push(eq(schema.tasks.assignee, who as Task["assignee"]));
  if (withStatus) {
    if (f.status === "open") where.push(ne(schema.tasks.status, "done"));
    else if (f.status !== "all") where.push(eq(schema.tasks.status, f.status as Task["status"]));
  }
  if (f.month) where.push(eq(schema.tasks.month, f.month));
  return where;
}

const byDue = [sql`${schema.tasks.dueDate} is null`, asc(schema.tasks.dueDate), desc(schema.tasks.createdAt)];

/** List / table / export: every filter applies. */
export async function loadTasks(f: TaskFilters, user: SessionUser, limit = 500) {
  const db = await getDb();
  const where = baseWhere(f, user, true);
  return db
    .select()
    .from(schema.tasks)
    .where(where.length ? and(...where) : undefined)
    .orderBy(...byDue)
    .limit(limit);
}

export const BOARD_DONE_DAYS = 14;

/** Board: the status filter doesn't apply (columns are statuses). Done shows the last 14 days only. */
export async function loadBoardTasks(f: TaskFilters, user: SessionUser) {
  const db = await getDb();
  const where = baseWhere(f, user, false);
  const since = new Date(Date.now() - BOARD_DONE_DAYS * 86_400_000);
  const recentDone = and(eq(schema.tasks.status, "done"), gte(schema.tasks.completedAt, since));
  const [open, done, [{ older }]] = await Promise.all([
    db.select().from(schema.tasks).where(and(...where, ne(schema.tasks.status, "done"))).orderBy(...byDue).limit(500),
    db.select().from(schema.tasks).where(and(...where, recentDone)).orderBy(desc(schema.tasks.completedAt)).limit(200),
    db
      .select({ older: sql<number>`count(*)::int` })
      .from(schema.tasks)
      .where(and(...where, eq(schema.tasks.status, "done"), sql`(${schema.tasks.completedAt} is null or ${schema.tasks.completedAt} < ${since.toISOString()})`)),
  ]);
  return { tasks: [...open, ...done], olderDone: older };
}

/** In-memory sort for the table (≤500 rows; business sorts by display name). Blank values sort last. */
export function sortTasks(tasks: Task[], f: TaskFilters, clientName: (t: Task) => string | null) {
  const statusIdx = (s: string) => (TASK_STATUSES as readonly string[]).indexOf(s);
  const key = (t: Task): string | number | null => {
    switch (f.sort) {
      case "title": return t.title.toLowerCase();
      case "business": return clientName(t)?.toLowerCase() ?? null;
      case "status": return statusIdx(t.status);
      case "assignee": return t.assignee === "unassigned" ? null : t.assignee;
      case "platform": return t.platform;
      case "month": return t.month;
      default: return t.dueDate;
    }
  };
  const mul = f.dir === "desc" ? -1 : 1;
  return [...tasks].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title);
    if (ka == null) return 1;
    if (kb == null) return -1;
    return (ka < kb ? -1 : 1) * mul;
  });
}

