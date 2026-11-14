import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { isMonth, today as todayYmd } from "./dates";
import { looksLikeMoney, matchBusiness, parseSchedule, scheduleNameKey, scrubMoney, type ParsedSchedule, type ParsedScheduleItem } from "./schedule-parse";
import type { IcalEvent } from "./ical";

/**
 * Nora's schedule: which businesses she's working with each month, on which day (or "sometime in
 * November"), whether it's free, and whether she still owes a reel (📸). No money is stored or shown.
 * Same conventions as lib/ops: zod input, `actor` is a user email or "claude", every write is logged.
 * Claude may add and update items (import a pasted list, fix a date); deleting items and ticking a
 * reel as posted are for people.
 */

export type ScheduleRow = schema.ScheduleItem & { clientName: string | null };
type Source = "paste" | "manual" | "claude";

const isClaude = (actor: string) => actor.toLowerCase() === "claude";
const sourceFor = (actor: string, fallback: Source): Source => (isClaude(actor) ? "claude" : fallback);
const short = (ymd: string | null) => (ymd ? `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}` : `no set day`);

const refineNoMoney = (what: string) => (v: string | null | undefined, ctx: z.RefinementCtx) => {
  if (looksLikeMoney(v)) ctx.addIssue({ code: "custom", message: `Leave money out of the ${what} — the schedule doesn't track payments.` });
};

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date should look like 2026-11-04.").refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s, "That date doesn't exist.");
const monthStr = z.string().refine(isMonth, "Month should look like 2026-11.");
const name = z.string().trim().min(1, "Give the business a name.").max(200).superRefine(refineNoMoney("business name"));
const notes = z.string().trim().max(2000).superRefine(refineNoMoney("notes")).nullish();

/* ───────────────────────── Businesses (for linking) ───────────────────────── */

async function activeBusinesses() {
  const db = await getDb();
  return db
    .select({ id: schema.clients.id, name: schema.clients.name, location: schema.clients.location })
    .from(schema.clients)
    .where(and(eq(schema.clients.archived, false), ne(schema.clients.kind, "creator")));
}

/* ───────────────────────── Read ───────────────────────── */

export async function listSchedule(month: string): Promise<ScheduleRow[]> {
  if (!isMonth(month)) throw new OpsError("Month should look like 2026-11.");
  const db = await getDb();
  const rows = await db
    .select({ s: schema.scheduleItems, clientName: schema.clients.name })
    .from(schema.scheduleItems)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.scheduleItems.clientId))
    .where(eq(schema.scheduleItems.month, month))
    .orderBy(sql`${schema.scheduleItems.date} asc nulls first`, asc(schema.scheduleItems.businessName));
  return rows.map((r) => ({ ...r.s, clientName: r.clientName }));
}

/** Every reel still owed (📸 and not ticked), oldest first. */
export async function reelsToPost(): Promise<ScheduleRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ s: schema.scheduleItems, clientName: schema.clients.name })
    .from(schema.scheduleItems)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.scheduleItems.clientId))
    .where(and(eq(schema.scheduleItems.needsReel, true), isNull(schema.scheduleItems.reelPostedAt)))
    .orderBy(asc(schema.scheduleItems.month), sql`${schema.scheduleItems.date} asc nulls last`, asc(schema.scheduleItems.businessName))
    .limit(500);
  return rows.map((r) => ({ ...r.s, clientName: r.clientName }));
}

export async function reelsToPostCount(): Promise<number> {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.scheduleItems)
    .where(and(eq(schema.scheduleItems.needsReel, true), isNull(schema.scheduleItems.reelPostedAt)));
  return Number(r?.n ?? 0);
}

/* ───────────────────────── Import (paste / Claude) ───────────────────────── */

export type ImportRow = {
  action: "add" | "update" | "unchanged";
  id?: string;
  month: string;
  date: string | null;
  businessName: string;
  isFree: boolean;
  needsReel: boolean;
  clientId: string | null;
  clientName: string | null;
  changes: string[]; // "date: no set day → 11/13", plain words, never money
};
export type ImportResult = {
  dryRun: boolean;
  add: number;
  update: number;
  unchanged: number;
  rows: ImportRow[];
  skipped: ParsedSchedule["skipped"];
};

/** Structured items (Claude's other way in). `date` is YYYY-MM-DD; `month` is needed only without a date. */
export const ScheduleItemInput = z.object({
  businessName: name,
  date: ymd.nullish(),
  month: monthStr.nullish(),
  isFree: z.boolean().optional(),
  needsReel: z.boolean().optional(),
});
export type ScheduleItemInput = z.input<typeof ScheduleItemInput>;

/** Like a parsed paste, but Free is undefined when Claude left it out (then the item's Free stays as it is). */
type StructuredItem = Omit<ParsedScheduleItem, "isFree"> & { isFree?: boolean };
type StructuredSchedule = { months: Array<{ month: string; items: StructuredItem[] }>; skipped: ParsedSchedule["skipped"] };

function fromStructured(items: ScheduleItemInput[]): StructuredSchedule {
  const byMonth = new Map<string, StructuredItem[]>();
  const skipped: ParsedSchedule["skipped"] = [];
  for (const raw of items) {
    const p = ScheduleItemInput.safeParse(raw);
    const label = scrubMoney(String((raw as { businessName?: unknown })?.businessName ?? "")).slice(0, 120);
    if (!p.success) {
      skipped.push({ line: label, reason: p.error.issues[0]?.message ?? "Invalid item" });
      continue;
    }
    const v = p.data;
    const month = v.date ? v.date.slice(0, 7) : v.month;
    if (!month) {
      skipped.push({ line: label, reason: "Give a date or a month." });
      continue;
    }
    if (v.date && v.month && v.month !== month) {
      skipped.push({ line: label, reason: `Date ${v.date} isn't in ${v.month}.` });
      continue;
    }
    const nameKey = scheduleNameKey(v.businessName);
    if (!nameKey) {
      skipped.push({ line: label, reason: "No business name." });
      continue;
    }
    const list = byMonth.get(month) ?? [];
    if (list.some((x) => x.nameKey === nameKey)) {
      skipped.push({ line: label, reason: `Listed twice in ${month}.` });
      continue;
    }
    list.push({ date: v.date ?? null, businessName: v.businessName, nameKey, isFree: v.isFree, needsReel: !!v.needsReel, line: label });
    byMonth.set(month, list);
  }
  return { months: [...byMonth.entries()].map(([month, items]) => ({ month, items })), skipped };
}

/**
 * Paste Nora's list (or pass structured items) → preview what would be added / updated / left alone, then
 * (unless dryRun) apply it. Re-importing is safe: items are matched by month + normalized name.
 *  - a date that's now known replaces "no set day" (or an older date); a missing date never clears one
 *  - 📸 is only ever added: a pending reel stays flagged even if a later paste drops the emoji
 *  - Free follows the latest paste; structured items without `isFree` leave Free as it is
 *  - new or unlinked items are linked to an active business when the name matches one
 */
export async function importSchedule(input: string | ScheduleItemInput[], actor: string, opts: { dryRun?: boolean; today?: string } = {}): Promise<ImportResult> {
  const dryRun = !!opts.dryRun;
  if (typeof input === "string" && input.length > 50_000) throw new OpsError("That's too much text — paste one or two months at a time.");
  if (Array.isArray(input) && input.length > 300) throw new OpsError("Up to 300 items at a time.");
  const parsed: StructuredSchedule = typeof input === "string" ? parseSchedule(input, { today: opts.today ?? todayYmd() }) : fromStructured(input);
  const months = parsed.months.map((m) => m.month);

  const db = await getDb();
  const [existing, businesses] = await Promise.all([
    months.length ? db.select().from(schema.scheduleItems).where(inArray(schema.scheduleItems.month, months)) : Promise.resolve([] as schema.ScheduleItem[]),
    activeBusinesses(),
  ]);
  const byKey = new Map(existing.map((e) => [`${e.month}|${e.nameKey}`, e]));
  const nameOf = new Map(businesses.map((b) => [b.id, b.name]));

  const rows: ImportRow[] = [];
  for (const { month, items } of parsed.months) {
    for (const it of items) {
      if (looksLikeMoney(it.businessName)) {
        // Last guard: the schedule never stores money, even if the parser missed some.
        parsed.skipped.push({ line: scrubMoney(it.line), reason: "The business name looks like it has an amount in it — leave money out." });
        continue;
      }
      const cur = byKey.get(`${month}|${it.nameKey}`);
      const match = matchBusiness(it.businessName, businesses);
      if (!cur) {
        rows.push({ action: "add", month, date: it.date, businessName: it.businessName, isFree: it.isFree ?? false, needsReel: it.needsReel, clientId: match?.id ?? null, clientName: match?.name ?? null, changes: [] });
        continue;
      }
      const changes: string[] = [];
      const date = it.date && it.date !== cur.date ? it.date : cur.date;
      if (date !== cur.date) changes.push(`date: ${short(cur.date)} → ${short(date)}`);
      const needsReel = cur.needsReel || it.needsReel;
      if (needsReel !== cur.needsReel) changes.push("reel to post: added");
      const isFree = it.isFree ?? cur.isFree;
      if (isFree !== cur.isFree) changes.push(isFree ? "now free" : "no longer free");
      const clientId = cur.clientId ?? match?.id ?? null;
      if (clientId !== cur.clientId) changes.push(`linked to ${match?.name ?? "a business"}`);
      rows.push({
        action: changes.length ? "update" : "unchanged",
        id: cur.id, month, date, businessName: cur.businessName, isFree, needsReel, clientId,
        clientName: clientId ? (nameOf.get(clientId) ?? null) : null, changes,
      });
    }
  }

  const result: ImportResult = {
    dryRun,
    add: rows.filter((r) => r.action === "add").length,
    update: rows.filter((r) => r.action === "update").length,
    unchanged: rows.filter((r) => r.action === "unchanged").length,
    rows,
    skipped: parsed.skipped,
  };
  if (dryRun || (!result.add && !result.update)) return result;

  const source = sourceFor(actor, typeof input === "string" ? "paste" : "manual");
  const now = new Date();
  for (const r of rows) {
    if (r.action === "add") {
      const id = newId("sch_");
      const inserted = await db
        .insert(schema.scheduleItems)
        .values({ id, month: r.month, date: r.date, businessName: r.businessName, nameKey: scheduleNameKey(r.businessName), clientId: r.clientId, isFree: r.isFree, needsReel: r.needsReel, source, createdBy: actor })
        .onConflictDoNothing()
        .returning({ id: schema.scheduleItems.id });
      if (inserted.length) r.id = id;
      else r.action = "unchanged"; // someone added it a moment ago
    } else if (r.action === "update" && r.id) {
      await db
        .update(schema.scheduleItems)
        .set({ date: r.date, needsReel: r.needsReel, isFree: r.isFree, clientId: r.clientId, updatedAt: now })
        .where(eq(schema.scheduleItems.id, r.id));
    }
  }
  result.add = rows.filter((r) => r.action === "add").length;

  const detail = rows
    .filter((r) => r.action !== "unchanged")
    .slice(0, 25)
    .map((r) => (r.action === "add" ? `+ ${r.businessName} (${short(r.date)})` : `${r.businessName}: ${r.changes.join(", ")}`))
    .join("; ");
  await logActivity({
    actor,
    action: "schedule.imported",
    entityType: "schedule",
    entityId: months.join(",").slice(0, 200) || "schedule",
    summary: `Updated Nora's schedule: ${result.add} added, ${result.update} updated${result.skipped.length ? `, ${result.skipped.length} lines skipped` : ""}. ${detail}`.slice(0, 2000),
  });
  return result;
}

/* ───────────────────────── Single items ───────────────────────── */

export const AddScheduleItem = z.object({
  businessName: name,
  date: ymd.nullish(),
  month: monthStr.nullish(),
  isFree: z.boolean().default(false),
  needsReel: z.boolean().default(false),
  notes,
  clientId: z.string().nullish(),
});

export async function addScheduleItem(input: z.input<typeof AddScheduleItem>, actor: string): Promise<string> {
  const v = AddScheduleItem.parse(input);
  const month = v.date ? v.date.slice(0, 7) : v.month;
  if (!month) throw new OpsError("Pick a day, or the month it's in.");
  if (v.date && v.month && v.month !== month) throw new OpsError("That day isn't in the chosen month.");
  const nameKey = scheduleNameKey(v.businessName);
  if (!nameKey) throw new OpsError("Give the business a name.");

  const db = await getDb();
  const businesses = await activeBusinesses();
  const clientId = v.clientId && businesses.some((b) => b.id === v.clientId) ? v.clientId : (matchBusiness(v.businessName, businesses)?.id ?? null);
  const id = newId("sch_");
  const inserted = await db
    .insert(schema.scheduleItems)
    .values({ id, month, date: v.date ?? null, businessName: v.businessName, nameKey, clientId, isFree: v.isFree, needsReel: v.needsReel, notes: v.notes?.trim() || null, source: sourceFor(actor, "manual"), createdBy: actor })
    .onConflictDoNothing()
    .returning({ id: schema.scheduleItems.id });
  if (!inserted.length) throw new OpsError(`${v.businessName} is already on the schedule for that month.`);
  await logActivity({
    actor, action: "schedule.added", entityType: "schedule_item", entityId: id, clientId,
    summary: `Added ${v.businessName} to Nora's schedule (${v.date ? short(v.date) : `sometime in ${month}`}${v.isFree ? ", free" : ""}${v.needsReel ? ", reel to post" : ""}).`,
  });
  return id;
}

export const UpdateScheduleItem = z.object({
  businessName: name.optional(),
  date: ymd.nullish(), // null = no set day (stays in its month)
  isFree: z.boolean().optional(),
  needsReel: z.boolean().optional(),
  notes,
  clientId: z.string().nullish(),
});

export async function updateScheduleItem(id: string, patch: z.input<typeof UpdateScheduleItem>, actor: string): Promise<void> {
  const v = UpdateScheduleItem.parse(patch);
  const db = await getDb();
  const [cur] = await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, id));
  if (!cur) throw new OpsError("That schedule item was deleted.");

  const set: Partial<schema.ScheduleItem> = {};
  const changes: string[] = [];
  if (v.businessName !== undefined && v.businessName !== cur.businessName) {
    set.businessName = v.businessName;
    set.nameKey = scheduleNameKey(v.businessName);
    changes.push(`name: ${cur.businessName} → ${v.businessName}`);
  }
  if (v.date !== undefined && v.date !== cur.date) {
    set.date = v.date ?? null;
    if (v.date) set.month = v.date.slice(0, 7);
    changes.push(`date: ${short(cur.date)} → ${short(v.date ?? null)}`);
  }
  if (v.isFree !== undefined && v.isFree !== cur.isFree) {
    set.isFree = v.isFree;
    changes.push(v.isFree ? "free: no → yes" : "free: yes → no");
  }
  if (v.needsReel !== undefined && v.needsReel !== cur.needsReel) {
    if (!v.needsReel && isClaude(actor) && !cur.reelPostedAt) throw new OpsError("Only Nora or Cameron can take a pending reel off the list.");
    set.needsReel = v.needsReel;
    changes.push(v.needsReel ? "reel to post: added" : "reel to post: removed");
  }
  if (v.notes !== undefined && (v.notes?.trim() || null) !== cur.notes) {
    set.notes = v.notes?.trim() || null;
    changes.push("notes updated");
  }
  if (v.clientId !== undefined && (v.clientId ?? null) !== cur.clientId) {
    if (v.clientId) {
      const [c] = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, v.clientId));
      if (!c) throw new OpsError("That business doesn't exist.");
      changes.push(`linked to ${c.name}`);
    } else changes.push("unlinked from its business");
    set.clientId = v.clientId ?? null;
  }
  if (!changes.length) return;

  const month = set.month ?? cur.month;
  const nameKey = set.nameKey ?? cur.nameKey;
  if (month !== cur.month || nameKey !== cur.nameKey) {
    const [clash] = await db
      .select({ id: schema.scheduleItems.id })
      .from(schema.scheduleItems)
      .where(and(eq(schema.scheduleItems.month, month), eq(schema.scheduleItems.nameKey, nameKey), ne(schema.scheduleItems.id, id)));
    if (clash) throw new OpsError(`${set.businessName ?? cur.businessName} is already on the schedule for ${month}.`);
  }
  await db.update(schema.scheduleItems).set({ ...set, updatedAt: new Date() }).where(eq(schema.scheduleItems.id, id));
  await logActivity({
    actor, action: "schedule.updated", entityType: "schedule_item", entityId: id, clientId: set.clientId ?? cur.clientId,
    summary: `Updated ${cur.businessName} on Nora's schedule — ${changes.join("; ")}.`,
  });
}

export async function deleteScheduleItem(id: string, actor: string): Promise<void> {
  if (isClaude(actor)) throw new OpsError("Only Nora or Cameron can remove something from the schedule.");
  const db = await getDb();
  const [cur] = await db.delete(schema.scheduleItems).where(eq(schema.scheduleItems.id, id)).returning();
  if (!cur) return;
  await logActivity({
    actor, action: "schedule.deleted", entityType: "schedule_item", entityId: id, clientId: cur.clientId,
    summary: `Removed ${cur.businessName} (${cur.date ? short(cur.date) : cur.month}) from Nora's schedule.`,
  });
}

/** Tick (or untick) a reel as posted. People only. */
export async function markReelPosted(id: string, actor: string, posted = true): Promise<void> {
  if (isClaude(actor)) throw new OpsError("Only Nora or Cameron can mark a reel as posted.");
  const db = await getDb();
  const [cur] = await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, id));
  if (!cur) throw new OpsError("That schedule item was deleted.");
  if (posted === !!cur.reelPostedAt) return;
  await db
    .update(schema.scheduleItems)
    .set({ reelPostedAt: posted ? new Date() : null, needsReel: posted ? true : cur.needsReel, updatedAt: new Date() })
    .where(eq(schema.scheduleItems.id, id));
  await logActivity({
    actor, action: posted ? "schedule.reel_posted" : "schedule.reel_unposted", entityType: "schedule_item", entityId: id, clientId: cur.clientId,
    summary: posted ? `Reel posted for ${cur.businessName}.` : `Reel for ${cur.businessName} marked as not posted yet.`,
  });
}

/* ───────────────────────── Calendar feed ───────────────────────── */

/** Dated schedule items between two days (inclusive) as all-day events. Undated items aren't in the feed. */
export async function scheduleIcalEvents(fromDate: string, toDate: string, link: (path: string) => string | null): Promise<IcalEvent[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.scheduleItems)
    .where(and(isNotNull(schema.scheduleItems.date), gte(schema.scheduleItems.date, fromDate), lte(schema.scheduleItems.date, toDate)));
  return rows.map((r) => {
    const url = link(`/calendar?month=${r.month}`);
    const reel = r.needsReel ? (r.reelPostedAt ? " · ✓ reel posted" : " · 📸 reel to post") : "";
    return {
      uid: `schedule-${r.id}@nora-hq`,
      summary: `Nora: ${r.businessName}${r.isFree ? " (free)" : ""}${reel}`,
      date: r.date!,
      description: url,
      url,
      lastModified: r.updatedAt,
      categories: ["Schedule"],
    };
  });
}
