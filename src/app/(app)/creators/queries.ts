import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, Creator, Draft, Outreach, OutreachStage } from "@/lib/schema";
import { currentMonth } from "@/lib/dates";
import { monthBounds as tzMonthBounds } from "@/lib/integrations/time";

/** Read helpers for the creators module. All mutations go through lib/ops. */

export type OutreachWithClient = Outreach & { client: Pick<Client, "id" | "name" | "location"> };
export type CreatorRow = Creator & { outreach: OutreachWithClient[] };

export const PIPELINE_STAGES = [
  "sourced",
  "shortlisted",
  "contacted",
  "followed_up",
  "replied",
  "negotiating",
  "agreed",
  "visit_scheduled",
  "posted",
] as const satisfies readonly OutreachStage[];
export const CLOSED_STAGES = ["declined", "no_response"] as const satisfies readonly OutreachStage[];
export const REPLIED_STAGES: readonly OutreachStage[] = ["replied", "negotiating", "agreed", "visit_scheduled", "posted", "declined"];
export const AGREED_STAGES: readonly OutreachStage[] = ["agreed", "visit_scheduled", "posted"];
export const FOLLOW_UP_STAGES: readonly OutreachStage[] = ["contacted", "followed_up"];

export const COMP_TYPES = ["gifted", "paid", "affiliate", "tbd"] as const;
export const COMP_LABEL: Record<string, string> = { gifted: "Gifted meal", paid: "Paid", affiliate: "Affiliate", tbd: "Comp TBD" };
export const CHANNEL_LABEL: Record<string, string> = { instagram_dm: "Instagram DM", tiktok_dm: "TikTok DM", email: "Email" };

export function isFollowUpDue(o: Pick<Outreach, "stage" | "nextFollowUpAt">, now = new Date()) {
  return !!o.nextFollowUpAt && o.nextFollowUpAt <= now && FOLLOW_UP_STAGES.includes(o.stage);
}

/** Every creator with their outreach rows (and business names). The roster is small, so filtering happens in JS. */
export async function listCreatorRows(): Promise<CreatorRow[]> {
  const db = await getDb();
  const [creators, rows] = await Promise.all([
    db.select().from(schema.creators).orderBy(asc(schema.creators.name)),
    db
      .select({ o: schema.outreach, c: { id: schema.clients.id, name: schema.clients.name, location: schema.clients.location } })
      .from(schema.outreach)
      .innerJoin(schema.clients, eq(schema.outreach.clientId, schema.clients.id))
      .orderBy(desc(schema.outreach.lastActivityAt)),
  ]);
  const byCreator = new Map<string, OutreachWithClient[]>();
  for (const r of rows) {
    const list = byCreator.get(r.o.creatorId) ?? [];
    list.push({ ...r.o, client: r.c });
    byCreator.set(r.o.creatorId, list);
  }
  return creators.map((c) => ({ ...c, outreach: byCreator.get(c.id) ?? [] }));
}

export async function getCreatorDetail(id: string) {
  const db = await getDb();
  const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.id, id));
  if (!creator) return null;
  const rows = await db
    .select({ o: schema.outreach, c: { id: schema.clients.id, name: schema.clients.name, location: schema.clients.location } })
    .from(schema.outreach)
    .innerJoin(schema.clients, eq(schema.outreach.clientId, schema.clients.id))
    .where(eq(schema.outreach.creatorId, id))
    .orderBy(asc(schema.clients.sortOrder), asc(schema.clients.name));
  const outreach: OutreachWithClient[] = rows.map((r) => ({ ...r.o, client: r.c }));
  const ids = outreach.map((o) => o.id);
  const drafts: Draft[] = ids.length
    ? await db
        .select()
        .from(schema.drafts)
        .where(inArray(sql`${schema.drafts.meta}->>'outreachId'`, ids))
        .orderBy(desc(schema.drafts.createdAt))
    : [];
  return { creator, outreach, drafts };
}

/** Finds a creator that upsertCreator would merge into (same IG handle, TikTok handle or email). */
export async function findExistingCreator(ig: string | null, tt: string | null, email: string | null) {
  const conds = [
    ig ? eq(schema.creators.instagramHandle, ig) : undefined,
    tt ? eq(schema.creators.tiktokHandle, tt) : undefined,
    email ? eq(schema.creators.email, email) : undefined,
  ].filter((c) => c !== undefined);
  if (!conds.length) return null;
  const db = await getDb();
  const [row] = await db.select({ id: schema.creators.id, name: schema.creators.name }).from(schema.creators).where(or(...conds)).limit(1);
  return row ?? null;
}

/** [start, next) of an app month (America/New_York), using the same boundaries as lib/reports. */
export function monthBounds(month = currentMonth()) {
  const { start, end } = tzMonthBounds(month); // app timezone, not UTC
  return { start, next: end };
}

/** Same normalisation lib/ops applies to handles, so lookups match stored values. */
export function normalizeHandle(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, "").replace(/\/.*$/, "").toLowerCase() : null;
}

export const igProfileUrl = (h: string) => `https://www.instagram.com/${encodeURIComponent(h)}/`;
export const igDmUrl = (h: string) => `https://ig.me/m/${encodeURIComponent(h)}`;
export const ttProfileUrl = (h: string) => `https://www.tiktok.com/@${encodeURIComponent(h)}`;

export async function findOutreach(clientId: string, creatorId: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.outreach)
    .where(and(eq(schema.outreach.clientId, clientId), eq(schema.outreach.creatorId, creatorId)));
  return row ?? null;
}
