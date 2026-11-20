import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, ne, notInArray, or } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { monthOfDate } from "./dates";
import { askTaskTitle } from "./ops-asks";
import { scheduleOn, type ScheduleDayItem } from "./ops-schedule";

/**
 * Nora's list: her Home. Her own tasks and reminders, grouped by when they're due (today, by the end of the week, no
 * date), plus the shoots on her schedule this week. Team-side volume (drafts to review, reels owed, creator outreach)
 * never shows here. Where something on Cameron's side matters to her, it shows up as a reminder for her: an ask she
 * sent Cameron that is still open after FOLLOW_UP_DAYS becomes "Follow up with Cameron: …" (tag "follow_up").
 */

export const FOLLOW_UP_DAYS = 3;
export const FOLLOW_UP_TAG = "follow_up";

/** "YYYY-MM-DD" + n days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Sunday that ends the week `date` is in (the date itself on a Sunday). */
export function endOfWeek(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, dow === 0 ? 0 : 7 - dow);
}

export type ListShoot = ScheduleDayItem & { day: string };

export type NoraList = {
  today: schema.Task[];
  week: schema.Task[];
  noDate: schema.Task[];
  later: number;
  doneRecently: schema.Task[];
  shootsToday: ListShoot[];
  shootsWeek: ListShoot[];
};

/**
 * An ask Nora sent that is Cameron's (routed to him) and still open after FOLLOW_UP_DAYS gets one reminder on her list,
 * due today. One per ask, ever: once she ticks it, it doesn't come back. It drops off her list by itself if the ask is
 * finished before she gets to it.
 */
export async function ensureFollowUps(email: string, name: string, now: string): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000);
  const stale = await db
    .select({ id: schema.asks.id, body: schema.asks.body, clientId: schema.asks.clientId })
    .from(schema.asks)
    .where(and(
      or(eq(schema.asks.createdBy, email), eq(schema.asks.createdBy, name)),
      eq(schema.asks.forWho, "cameron"),
      inArray(schema.asks.status, ["new", "in_progress"]),
      ne(schema.asks.kind, "idea"),
      lt(schema.asks.createdAt, cutoff),
    ))
    .limit(20);
  if (!stale.length) return 0;
  const have = await db
    .select({ askId: schema.tasks.askId })
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.askId, stale.map((a) => a.id)), eq(schema.tasks.tag, FOLLOW_UP_TAG)));
  const done = new Set(have.map((t) => t.askId));
  let made = 0;
  for (const a of stale) {
    if (done.has(a.id)) continue;
    const id = newId("tsk_");
    const title = `Follow up with Cameron: ${askTaskTitle(a.body)}`;
    await db.insert(schema.tasks).values({
      id,
      clientId: a.clientId,
      title,
      details: `You asked Cameron this ${FOLLOW_UP_DAYS}+ days ago and it's still open. Check in with him, then tick this off.`,
      status: "todo",
      assignee: "nora",
      dueDate: now,
      month: monthOfDate(now),
      askId: a.id,
      tag: FOLLOW_UP_TAG,
      createdBy: "nora-hq",
    });
    await logActivity({ actor: "nora-hq", action: "task.created", entityType: "task", entityId: id, clientId: a.clientId, summary: `Reminder for Nora: ${title}` });
    made++;
  }
  return made;
}

export async function loadNoraList(now: string): Promise<NoraList> {
  const db = await getDb();
  const weekEnd = endOfWeek(now);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const days: string[] = [];
  for (let d = now; d <= weekEnd; d = addDays(d, 1)) days.push(d);

  const [open, doneRecently, schedule] = await Promise.all([
    db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.assignee, "nora"), ne(schema.tasks.status, "done")))
      .orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt))
      .limit(200),
    db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.assignee, "nora"), eq(schema.tasks.status, "done"), gte(schema.tasks.completedAt, since)))
      .orderBy(desc(schema.tasks.completedAt))
      .limit(10),
    Promise.all(days.map(async (day) => (await scheduleOn(day)).map((s) => ({ ...s, day })))),
  ]);

  // A follow-up whose ask is already finished has nothing left to chase.
  const followAsks = open.filter((t) => t.tag === FOLLOW_UP_TAG && t.askId).map((t) => t.askId!);
  const closed = new Set<string>();
  if (followAsks.length) {
    const rows = await db.select({ id: schema.asks.id }).from(schema.asks)
      .where(and(inArray(schema.asks.id, followAsks), notInArray(schema.asks.status, ["new", "in_progress"])));
    for (const r of rows) closed.add(r.id);
  }
  const tasks = open.filter((t) => !(t.tag === FOLLOW_UP_TAG && t.askId && closed.has(t.askId)));

  const today: schema.Task[] = [];
  const week: schema.Task[] = [];
  const noDate: schema.Task[] = [];
  let later = 0;
  for (const t of tasks) {
    if (!t.dueDate) noDate.push(t);
    else if (t.dueDate <= now) today.push(t); // overdue counts as today
    else if (t.dueDate <= weekEnd) week.push(t);
    else later++;
  }
  // Newest first for undated ones: what was just added sits on top.
  noDate.sort((a, b) => +b.createdAt - +a.createdAt);

  const shoots = schedule.flat();
  return {
    today,
    week,
    noDate,
    later,
    doneRecently,
    shootsToday: shoots.filter((s) => s.day === now),
    shootsWeek: shoots.filter((s) => s.day !== now),
  };
}

/** A reminder's due date from its "When" choice: "today", "week" (this Sunday) or anything else (no date). */
export function reminderDue(when: string, now: string): string | null {
  if (when === "today") return now;
  if (when === "week") return endOfWeek(now);
  return null;
}

