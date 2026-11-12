import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { allowedUsers } from "./auth";
import { APP_TZ, today } from "./dates";
import { OpsError } from "./ops";
import { appUrl } from "./integrations/oauth";
import { buildCalendar, type IcalEvent } from "./ical";
import { personEmail, sendToUser } from "./notify";
import { NOTIFY_TOPICS, type NotifyTopic } from "./schema";

/**
 * Phone notifications (device subscriptions + topics) and the private calendar feed.
 * Same conventions as lib/ops: zod-validated input, `actor` is a user email (or "system"), activity logged.
 * Delivery itself lives in lib/notify.ts.
 */

/** Where a deal opens in the app. One place to change if the deals page moves. */
export const dealHref = (id: string) => `/deals/${id}`;

const lower = (s: string) => s.trim().toLowerCase();
const userFor = (email: string) => allowedUsers().find((u) => u.email === lower(email)) ?? null;
const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/* ───────────────────────── Push devices ───────────────────────── */

const SubscriptionInput = z.object({
  endpoint: z.url().max(2000).refine((u) => u.startsWith("https://"), "Push endpoint must be https"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
const TopicsInput = z.array(z.enum(NOTIFY_TOPICS)).max(NOTIFY_TOPICS.length);

export type PushDevice = {
  id: string;
  /** sha256(endpoint) prefix: lets the browser recognise "this device" without the endpoint leaving the server. */
  endpointKey: string;
  label: string;
  topics: NotifyTopic[];
  lastSentAt: Date | null;
  createdAt: Date;
};

/** "iPhone · Safari" style label from a user agent. */
export function deviceLabel(ua: string | null | undefined): string {
  const u = ua ?? "";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Macintosh|Mac OS X/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : /Linux/.test(u) ? "Linux" : "Device";
  const br = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /CriOS|Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

/** Saves (or re-assigns) a device's push subscription for `userEmail`. Idempotent per endpoint. */
export async function savePushSubscription(input: unknown, userEmail: string, userAgent: string | null) {
  const v = SubscriptionInput.parse(input);
  const email = lower(userEmail);
  if (!userFor(email)) throw new OpsError("Only people who can sign in can turn on notifications.");
  const db = await getDb();
  const [existing] = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, v.endpoint));
  const ua = userAgent?.slice(0, 300) ?? null;
  if (existing) {
    await db.update(schema.pushSubscriptions)
      .set({ userEmail: email, p256dh: v.keys.p256dh, auth: v.keys.auth, userAgent: ua })
      .where(eq(schema.pushSubscriptions.id, existing.id));
    if (existing.userEmail === email) return { id: existing.id, created: false };
  }
  const id = existing?.id ?? newId("push_");
  if (!existing) {
    await db.insert(schema.pushSubscriptions).values({ id, userEmail: email, endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth, userAgent: ua });
  }
  await logActivity({ actor: email, action: "push.subscribed", entityType: "push_subscription", entityId: id, summary: `Turned on phone notifications (${deviceLabel(ua)})` });
  return { id, created: true };
}

/** Removes this device's subscription (by endpoint), only if it belongs to the actor. Idempotent. */
export async function removePushSubscription(endpoint: string, actor: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, String(endpoint)));
  if (!row || row.userEmail !== lower(actor)) return false;
  await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, row.id));
  await logActivity({ actor: lower(actor), action: "push.unsubscribed", entityType: "push_subscription", entityId: row.id, summary: `Turned off phone notifications (${deviceLabel(row.userAgent)})` });
  return true;
}

/** Removes one of the actor's devices by id (e.g. an old phone). */
export async function removePushDevice(id: string, actor: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, id));
  if (!row || row.userEmail !== lower(actor)) throw new OpsError("Device not found.");
  return removePushSubscription(row.endpoint, actor);
}

export async function listPushDevices(userEmail: string): Promise<PushDevice[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userEmail, lower(userEmail)))
    .orderBy(desc(schema.pushSubscriptions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    endpointKey: shortHash(r.endpoint),
    label: deviceLabel(r.userAgent),
    topics: (r.topics ?? []).filter((t): t is NotifyTopic => (NOTIFY_TOPICS as readonly string[]).includes(t)),
    lastSentAt: r.lastSentAt,
    createdAt: r.createdAt,
  }));
}

/** Sets which topics one of the actor's devices gets. */
export async function setPushTopics(id: string, topics: unknown, actor: string) {
  const t = [...new Set(TopicsInput.parse(topics))];
  const db = await getDb();
  const [row] = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, id));
  if (!row || row.userEmail !== lower(actor)) throw new OpsError("Device not found.");
  await db.update(schema.pushSubscriptions).set({ topics: t }).where(eq(schema.pushSubscriptions.id, id));
  await logActivity({ actor: lower(actor), action: "push.topics", entityType: "push_subscription", entityId: id, summary: `Changed notification settings (${deviceLabel(row.userAgent)})` });
  return t;
}

/* ───────────────────────── Calendar feed tokens ───────────────────────── */

const CAL_PREFIX = "nhc_";
const CAL_RE = /^nhc_[A-Za-z0-9_-]{43}$/;
const hashToken = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

export type CalendarFeedSummary = { id: string; createdAt: Date; lastFetchedAt: Date | null };

/** The person's active feed link (metadata only — the raw token is never stored). */
export async function getCalendarFeed(userEmail: string): Promise<CalendarFeedSummary | null> {
  const db = await getDb();
  const [row] = await db.select({ id: schema.calendarFeeds.id, createdAt: schema.calendarFeeds.createdAt, lastFetchedAt: schema.calendarFeeds.lastFetchedAt })
    .from(schema.calendarFeeds)
    .where(and(eq(schema.calendarFeeds.userEmail, lower(userEmail)), isNull(schema.calendarFeeds.revokedAt)))
    .orderBy(desc(schema.calendarFeeds.createdAt)).limit(1);
  return row ?? null;
}

/** Makes a new private feed link for the actor (turning off any previous one). Returns the raw token once. */
export async function createCalendarFeed(actor: string) {
  const email = lower(actor);
  if (!userFor(email)) throw new OpsError("Calendar links are only for people who can sign in.");
  const db = await getDb();
  await db.update(schema.calendarFeeds).set({ revokedAt: new Date() })
    .where(and(eq(schema.calendarFeeds.userEmail, email), isNull(schema.calendarFeeds.revokedAt)));
  const token = `${CAL_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = newId("cal_");
  await db.insert(schema.calendarFeeds).values({ id, userEmail: email, tokenHash: hashToken(token) });
  await logActivity({ actor: email, action: "calendar_feed.created", entityType: "calendar_feed", entityId: id, summary: "Made a calendar subscription link" });
  return { id, token };
}

/** Turns off the actor's feed link. Idempotent. */
export async function revokeCalendarFeed(id: string, actor: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.calendarFeeds).where(eq(schema.calendarFeeds.id, id));
  if (!row || row.userEmail !== lower(actor)) throw new OpsError("Calendar link not found.");
  if (row.revokedAt) return;
  await db.update(schema.calendarFeeds).set({ revokedAt: new Date() }).where(eq(schema.calendarFeeds.id, id));
  await logActivity({ actor: lower(actor), action: "calendar_feed.revoked", entityType: "calendar_feed", entityId: id, summary: "Turned off a calendar subscription link" });
}

/** Raw token → its person, or null (unknown, revoked, or removed from APP_USERS). Updates lastFetchedAt. */
export async function verifyCalendarToken(raw: string | null | undefined) {
  if (!raw || !CAL_RE.test(raw)) return null;
  const hash = hashToken(raw);
  const db = await getDb();
  const [row] = await db.select().from(schema.calendarFeeds)
    .where(and(eq(schema.calendarFeeds.tokenHash, hash), isNull(schema.calendarFeeds.revokedAt)));
  if (!row) return null;
  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const user = userFor(row.userEmail);
  if (!user) return null;
  // Calendar apps poll often; only write when it's been a while.
  if (!row.lastFetchedAt || Date.now() - row.lastFetchedAt.getTime() > 10 * 60_000) {
    await db.update(schema.calendarFeeds).set({ lastFetchedAt: new Date() }).where(eq(schema.calendarFeeds.id, row.id));
  }
  return { feedId: row.id, user };
}

/* ───────────────────────── Calendar feed content ───────────────────────── */

const DELIVERABLE_LABEL: Record<string, string> = { ig_reel: "IG Reel", ig_post: "IG post", ig_story: "IG story", tiktok: "TikTok", photos: "Photos", other: "Deliverable" };

function addDaysYmd(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const money = (cents: number | null) => (cents == null ? null : `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** Everything in one person's feed: visits, scheduled posts, deliverable due dates, and their own tasks with due dates. */
export async function calendarFor(userEmail: string, now = new Date(), origin?: string): Promise<string> {
  const user = userFor(userEmail);
  if (!user) throw new OpsError("unknown user");
  const db = await getDb();
  const base = appUrl() ?? origin?.replace(/\/+$/, "") ?? "";
  const link = (path: string) => (base ? `${base}${path}` : null);
  const fromDate = addDaysYmd(today(now), -30);
  const toDate = addDaysYmd(today(now), 120);
  const from = new Date(now.getTime() - 31 * 86400_000);
  const to = new Date(now.getTime() + 121 * 86400_000);
  const person = user.name.toLowerCase().split(" ")[0] as schema.Assignee;

  const [visits, posts, dels, tasks] = await Promise.all([
    db.select().from(schema.deals).where(and(isNotNull(schema.deals.visitAt), gte(schema.deals.visitAt, from), lte(schema.deals.visitAt, to), ne(schema.deals.status, "cancelled"))),
    db.select({ p: schema.contentPosts, clientName: schema.clients.name }).from(schema.contentPosts)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.contentPosts.clientId))
      .where(and(isNotNull(schema.contentPosts.scheduledFor), gte(schema.contentPosts.scheduledFor, from), lte(schema.contentPosts.scheduledFor, to))),
    db.select({ d: schema.dealDeliverables, businessName: schema.deals.businessName, dealStatus: schema.deals.status }).from(schema.dealDeliverables)
      .innerJoin(schema.deals, eq(schema.deals.id, schema.dealDeliverables.dealId))
      .where(and(isNotNull(schema.dealDeliverables.dueDate), gte(schema.dealDeliverables.dueDate, fromDate), lte(schema.dealDeliverables.dueDate, toDate), ne(schema.deals.status, "cancelled")))
      .orderBy(asc(schema.dealDeliverables.sortOrder)),
    db.select().from(schema.tasks).where(and(eq(schema.tasks.assignee, person), isNotNull(schema.tasks.dueDate), gte(schema.tasks.dueDate, fromDate), lte(schema.tasks.dueDate, toDate), ne(schema.tasks.status, "done"))),
  ]);

  const events: IcalEvent[] = [];
  for (const d of visits) {
    const desc = [
      d.contactName ? `Contact: ${d.contactName}${d.contactPhone ? ` · ${d.contactPhone}` : ""}` : null,
      d.compType ? `Comp: ${d.compType.replace(/_/g, " ")}${money(d.amountCents) ? ` · ${money(d.amountCents)}` : ""}` : null,
      d.menuNotes ? `Menu: ${d.menuNotes}` : null,
      d.dietaryNotes ? `Dietary: ${d.dietaryNotes}` : null,
      d.filmingNotes ? `Filming: ${d.filmingNotes}` : null,
      d.shotList?.length ? `Shot list:\n${d.shotList.map((s) => `${s.done ? "✓" : "•"} ${s.text}`).join("\n")}` : null,
      d.notes ? `Notes: ${d.notes}` : null,
      link(dealHref(d.id)),
    ].filter(Boolean).join("\n");
    events.push({ uid: `deal-visit-${d.id}@nora-hq`, summary: `Visit: ${d.businessName}`, start: d.visitAt!, minutes: 90, location: d.address, description: desc, url: link(dealHref(d.id)), lastModified: d.updatedAt, categories: ["Visit"] });
  }
  for (const { p, clientName } of posts) {
    const done = p.status === "published";
    const what = `${p.platform === "tiktok" ? "TikTok" : "Instagram"} ${p.format}`;
    events.push({
      uid: `post-${p.id}@nora-hq`,
      summary: `${done ? "✓ " : ""}Post: ${clientName} (${what})`,
      start: p.scheduledFor!, minutes: 15,
      description: [`Status: ${p.status}`, p.caption ? `\n${p.caption.slice(0, 1500)}` : null, link(`/calendar/${p.id}`)].filter(Boolean).join("\n"),
      url: link(`/calendar/${p.id}`), categories: ["Post"],
    });
  }
  for (const { d, businessName } of dels) {
    events.push({
      uid: `deliverable-${d.id}@nora-hq`,
      summary: `${d.postedAt ? "✓ " : ""}Due: ${DELIVERABLE_LABEL[d.kind] ?? d.kind} for ${businessName}`,
      date: d.dueDate!,
      description: [d.postUrl ? `Posted: ${d.postUrl}` : null, link(dealHref(d.dealId))].filter(Boolean).join("\n") || null,
      url: link(dealHref(d.dealId)), categories: ["Deliverable"],
    });
  }
  for (const t of tasks) {
    events.push({
      uid: `task-${t.id}@nora-hq`, summary: `Task: ${t.title}`, date: t.dueDate!,
      description: [t.details?.slice(0, 1500), link(`/tasks/${t.id}`)].filter(Boolean).join("\n\n") || null,
      url: link(`/tasks/${t.id}`), categories: ["Task"],
    });
  }
  return buildCalendar({ name: `Nora HQ · ${user.name}`, description: "Visits, scheduled posts, deliverables and your tasks from Nora HQ.", events, now });
}

/* ───────────────────────── Daily reminders (cron) ───────────────────────── */

/** Reminders go out on the first cron run at or after this hour (app timezone). */
const DAILY_HOUR = 8;

function hourInTz(d: Date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hour: "numeric", hourCycle: "h23" }).format(d));
}
const timeInTz = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hour: "numeric", minute: "2-digit" }).format(d);
const shortDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Once a day (first sync run after 8am NY): payments overdue → Nora; tomorrow's visits → Nora (with address).
 * Safe to call hourly: an app_settings row ("notify.daily") records the day it ran, claimed atomically.
 */
export async function runDailyReminders(now = new Date(), opts: { force?: boolean } = {}) {
  const day = today(now);
  if (!opts.force && hourInTz(now) < DAILY_HOUR) return { ok: true, skipped: "too_early" as const };
  const db = await getDb();
  if (!opts.force) {
    const claimed = await db.insert(schema.appSettings)
      .values({ key: "notify.daily", value: { date: day }, updatedBy: "system" })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: { date: day }, updatedAt: new Date(), updatedBy: "system" },
        setWhere: sql`(${schema.appSettings.value} ->> 'date') is distinct from ${day}`,
      })
      .returning({ key: schema.appSettings.key });
    if (!claimed.length) return { ok: true, skipped: "already_ran" as const };
  }
  const nora = personEmail("nora");
  if (!nora) return { ok: true, skipped: "no_nora" as const };

  const overdue = await db.select().from(schema.deals).where(and(
    eq(schema.deals.paymentStatus, "requested"), isNotNull(schema.deals.paymentDueDate), lt(schema.deals.paymentDueDate, day), ne(schema.deals.status, "cancelled"),
  )).orderBy(asc(schema.deals.paymentDueDate));
  let paymentSent = 0;
  if (overdue.length) {
    const list = overdue.slice(0, 4).map((d) => `${d.businessName}${money(d.amountCents) ? ` ${money(d.amountCents)}` : ""} (due ${shortDate(d.paymentDueDate!)})`).join(" · ");
    const r = await sendToUser(nora, "payment_overdue", {
      title: overdue.length === 1 ? "Payment overdue" : `${overdue.length} payments overdue`,
      body: overdue.length > 4 ? `${list} · +${overdue.length - 4} more` : list,
      url: overdue.length === 1 ? dealHref(overdue[0].id) : "/deals",
      tag: `payment-overdue-${day}`,
    });
    paymentSent = r.sent;
  }

  const tomorrow = addDaysYmd(day, 1);
  const soon = await db.select().from(schema.deals).where(and(
    isNotNull(schema.deals.visitAt), gte(schema.deals.visitAt, now), lte(schema.deals.visitAt, new Date(now.getTime() + 50 * 3600_000)), ne(schema.deals.status, "cancelled"),
  )).orderBy(asc(schema.deals.visitAt));
  const visits = soon.filter((d) => today(d.visitAt!) === tomorrow);
  let visitSent = 0;
  for (const d of visits) {
    const r = await sendToUser(nora, "visit_reminder", {
      title: `Tomorrow ${timeInTz(d.visitAt!)}: ${d.businessName}`,
      body: [d.address, d.dietaryNotes ? `Dietary: ${d.dietaryNotes}` : null].filter(Boolean).join(" · ") || "Visit tomorrow",
      url: dealHref(d.id),
      tag: `visit-${d.id}`,
    });
    visitSent += r.sent;
  }
  return { ok: true, overdue: overdue.length, visitsTomorrow: visits.length, sent: paymentSent + visitSent };
}
