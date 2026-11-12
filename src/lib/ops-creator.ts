import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { currentMonth, today } from "./dates";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import type { Connection, CreatorMedia, CreatorPlatform, CreatorSnapshot } from "./schema";

/**
 * Nora's own creator stats (@noraeatsgood on Instagram + TikTok).
 *
 * Snapshot semantics (one row per platform per day, date = YYYY-MM-DD in APP_TZ):
 *  - followers / following / posts / likesTotal: totals as of that day.
 *  - source "api", Instagram: views / reach / profileViews / interactions / newFollows are that day's flow.
 *  - source "api", TikTok: views = sum of view_count across every tracked video (a running total; the UI uses
 *    day-over-day deltas).
 *  - source "manual": views = the trailing-window figure the app shows (IG "last 30 days", TikTok "last 28 days").
 *
 * Routine sync writes (actor "system") are not logged to activity — they happen hourly. Manual entries,
 * collab tags and connecting an account are logged.
 */

const Platform = z.enum(schema.CREATOR_PLATFORMS);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Actor = z.string().trim().min(1).max(200);
const Count = z.number().int().min(0).max(2_000_000_000).nullish();

export const PLATFORM_LABEL: Record<CreatorPlatform, string> = { instagram: "Instagram", tiktok: "TikTok" };

/* ───────────────────────── Dates ───────────────────────── */

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/* ───────────────────────── Snapshots ───────────────────────── */

const SnapshotValues = z.object({
  followers: Count, following: Count, posts: Count, likesTotal: Count, views: Count, reach: Count,
  profileViews: Count, interactions: Count, newFollows: Count,
});
export type SnapshotValues = z.input<typeof SnapshotValues>;

/**
 * Creates or updates one day's snapshot. Only fields present (not undefined) are written, so a sync that
 * only fetched followers never wipes the views a previous run stored.
 */
export async function upsertSnapshot(platform: CreatorPlatform, date: string, values: SnapshotValues, source: "api" | "manual", actor: string) {
  Platform.parse(platform);
  DateStr.parse(date);
  Actor.parse(actor);
  const v = SnapshotValues.parse(values);
  const set: Partial<typeof schema.creatorSnapshots.$inferInsert> = { source, updatedAt: new Date() };
  for (const [k, val] of Object.entries(v)) if (val !== undefined) (set as Record<string, unknown>)[k] = val;
  // An API write that takes over a manual row must not keep the manual trailing-window `views` (IG "last 30
  // days" / TikTok "last 28 days"): under source "api" it would be read as one day's flow / a running total.
  const onConflict: Record<string, unknown> = { ...set };
  if (source === "api" && v.views === undefined) {
    onConflict.views = sql.raw(`CASE WHEN "creator_snapshots"."source" = 'manual' THEN NULL ELSE "creator_snapshots"."views" END`);
  }
  const db = await getDb();
  const [row] = await db
    .insert(schema.creatorSnapshots)
    .values({ id: newId("csn_"), platform, date, ...set })
    .onConflictDoUpdate({ target: [schema.creatorSnapshots.platform, schema.creatorSnapshots.date], set: onConflict })
    .returning();
  return row;
}

/** The 20-second "Log today's numbers" path, for before the APIs are connected. */
export async function recordManualSnapshot(platform: CreatorPlatform, date: string, input: { followers: number; views?: number | null }, actor: string) {
  Platform.parse(platform);
  DateStr.parse(date);
  const a = Actor.parse(actor);
  const v = z.object({ followers: z.number().int().min(0).max(2_000_000_000), views: Count }).parse(input);
  if (date > today()) throw new OpsError("That date is in the future.");
  const db = await getDb();
  const s = schema.creatorSnapshots;
  const [cur] = await db.select().from(s).where(and(eq(s.platform, platform), eq(s.date, date)));
  if (cur?.source === "api") throw new OpsError(`${PLATFORM_LABEL[platform]} already synced ${date} automatically, so there's nothing to log.`);
  await upsertSnapshot(platform, date, { followers: v.followers, ...(v.views != null ? { views: v.views } : {}) }, "manual", a);
  await logActivity({
    actor: a, action: "creator_stats.logged", entityType: "creator_stats", entityId: `${platform}:${date}`,
    summary: `Logged ${PLATFORM_LABEL[platform]} numbers for ${date}: ${v.followers.toLocaleString("en-US")} followers${v.views != null ? `, ${v.views.toLocaleString("en-US")} views` : ""}`,
  });
}

/* ───────────────────────── Media ───────────────────────── */

const MediaRow = z.object({
  externalId: z.string().min(1).max(200),
  permalink: z.string().max(2000).nullish(),
  thumbnailUrl: z.string().max(4000).nullish(),
  caption: z.string().max(5000).nullish(),
  mediaType: z.string().max(40).nullish(),
  postedAt: z.date().nullish(),
  views: Count, reach: Count, likes: Count, comments: Count, shares: Count, saves: Count,
});
export type MediaRowInput = z.input<typeof MediaRow>;

/** Upserts the latest stats for posts/videos. Never touches clientId (the collab tag is a person's choice). */
export async function upsertMedia(platform: CreatorPlatform, rows: MediaRowInput[], actor: string): Promise<number> {
  Platform.parse(platform);
  Actor.parse(actor);
  if (rows.length === 0) return 0;
  const db = await getDb();
  const now = new Date();
  let n = 0;
  for (const raw of rows) {
    const r = MediaRow.parse(raw);
    const vals = {
      permalink: r.permalink ?? null, thumbnailUrl: r.thumbnailUrl ?? null, caption: r.caption ?? null, mediaType: r.mediaType ?? null,
      postedAt: r.postedAt ?? null, views: r.views ?? null, reach: r.reach ?? null, likes: r.likes ?? null, comments: r.comments ?? null,
      shares: r.shares ?? null, saves: r.saves ?? null, updatedAt: now,
    };
    await db.insert(schema.creatorMedia).values({ id: newId("cmd_"), platform, externalId: r.externalId, ...vals })
      .onConflictDoUpdate({ target: [schema.creatorMedia.platform, schema.creatorMedia.externalId], set: vals });
    n++;
  }
  return n;
}

/** Links a post to the business it was a collab for (or clears it with null). */
export async function tagMediaClient(mediaId: string, clientId: string | null, actor: string) {
  const a = Actor.parse(actor);
  z.string().min(1).parse(mediaId);
  const db = await getDb();
  const [m] = await db.select().from(schema.creatorMedia).where(eq(schema.creatorMedia.id, mediaId));
  if (!m) throw new OpsError("That post isn't in Nora HQ anymore.");
  let clientName: string | null = null;
  if (clientId) {
    const [c] = await db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!c) throw new OpsError("That business doesn't exist.");
    clientName = c.name;
  }
  if ((m.clientId ?? null) === (clientId ?? null)) return;
  await db.update(schema.creatorMedia).set({ clientId: clientId ?? null }).where(eq(schema.creatorMedia.id, mediaId));
  const what = `${PLATFORM_LABEL[m.platform]} ${m.mediaType ?? "post"}${m.caption ? ` “${m.caption.slice(0, 50)}${m.caption.length > 50 ? "…" : ""}”` : ""}`;
  await logActivity({
    actor: a, action: clientId ? "creator_media.tagged" : "creator_media.untagged", entityType: "creator_media", entityId: mediaId,
    clientId: clientId ?? m.clientId, summary: clientId ? `Tagged ${what} as a collab for ${clientName}` : `Removed the collab tag from ${what}`,
  });
}

/* ───────────────────────── Audience ───────────────────────── */

const AudienceData = z.record(z.string(), z.array(z.object({ key: z.string().max(200), value: z.number() })).max(200));

export async function saveAudience(platform: CreatorPlatform, data: Record<string, Array<{ key: string; value: number }>>, actor: string) {
  Platform.parse(platform);
  Actor.parse(actor);
  const d = AudienceData.parse(data);
  if (Object.values(d).every((l) => l.length === 0)) return null;
  const db = await getDb();
  const [row] = await db.insert(schema.creatorAudience).values({ id: newId("cau_"), platform, data: d }).returning();
  return row;
}

export async function lastAudienceAt(platform: CreatorPlatform): Promise<Date | null> {
  const db = await getDb();
  const [row] = await db.select({ at: schema.creatorAudience.capturedAt }).from(schema.creatorAudience)
    .where(eq(schema.creatorAudience.platform, platform)).orderBy(desc(schema.creatorAudience.capturedAt)).limit(1);
  return row?.at ?? null;
}

/* ───────────────────────── Creator connections ───────────────────────── */

/** Nora's own account for a platform (purpose "creator"). Newest wins. */
export async function findCreatorConnection(provider: CreatorPlatform): Promise<Connection | null> {
  const db = await getDb();
  const c = schema.connections;
  const [row] = await db.select().from(c).where(and(eq(c.provider, provider), eq(c.purpose, "creator"))).orderBy(desc(c.updatedAt)).limit(1);
  return row ?? null;
}

const CreatorConnectionInput = z.object({
  provider: Platform,
  label: z.string().min(1).max(200),
  externalId: z.string().min(1).max(200),
  tokens: z.record(z.string(), z.unknown()),
  scopes: z.string().nullish(),
  expiresAt: z.date().nullish(),
});

/**
 * Stores Nora's own account (purpose "creator", no business). Replaces any previous creator account for the
 * same platform; never touches the businesses' connections.
 */
export async function saveCreatorConnection(input: z.input<typeof CreatorConnectionInput>, actor: string) {
  const a = Actor.parse(actor);
  const v = CreatorConnectionInput.parse(input);
  const { encryptJson } = await import("./crypto");
  const db = await getDb();
  const c = schema.connections;
  const now = new Date();
  const vals = {
    clientId: null, purpose: "creator" as const, label: v.label.trim(), tokenEnc: encryptJson(v.tokens), scopes: v.scopes ?? null,
    expiresAt: v.expiresAt ?? null, status: "ok" as const, lastError: null, updatedAt: now,
  };
  const [row] = await db.insert(c).values({ id: newId("con_"), provider: v.provider, externalId: v.externalId, ...vals })
    .onConflictDoUpdate({ target: [c.provider, c.externalId], set: vals }).returning();
  await db.delete(c).where(and(eq(c.provider, v.provider), eq(c.purpose, "creator"), sql`${c.id} <> ${row.id}`));
  await logActivity({ actor: a, action: "connection.connected", entityType: "connection", entityId: row.id, summary: `Connected Nora's ${PLATFORM_LABEL[v.provider]}: ${vals.label}` });
  return row.id;
}

/* ───────────────────────── Reads (page + Claude) ───────────────────────── */

export type PlatformSummary = {
  platform: CreatorPlatform;
  connected: boolean;
  connectionLabel: string | null;
  connectionStatus: "ok" | "error" | "expired" | null;
  connectionError: string | null;
  missingScopes: string[];
  lastSyncedAt: Date | null;
  followers: number | null;
  followersDate: string | null;
  change7: number | null;
  change30: number | null;
  views28: number | null;
  viewsNote: string | null;
  engagementRate: number | null; // 0..1
  avgViewsLast10: number | null;
  postsThisMonth: number | null;
};

export type TopPost = Pick<CreatorMedia, "id" | "platform" | "permalink" | "thumbnailUrl" | "caption" | "mediaType" | "views" | "reach" | "likes" | "comments" | "shares" | "saves" | "clientId"> & {
  postedAt: Date | null;
};

export type CreatorStats = {
  today: string;
  platforms: Record<CreatorPlatform, PlatformSummary>;
  series: Record<CreatorPlatform, Array<{ date: string; followers: number }>>;
  topPosts: TopPost[];
  audience: { capturedAt: Date; cities: Array<{ key: string; value: number }>; ages: Array<{ key: string; value: number }>; genders: Array<{ key: string; value: number }> } | null;
  mediaKit: { text: string; numbers: Array<{ label: string; value: string }> };
};

export const TIKTOK_WANTED_SCOPES = ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"];
export const IG_CREATOR_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];

/** The snapshot with followers closest to `target`, among those dated within [from, to] (none if there are none). */
function followersNear(rows: CreatorSnapshot[], target: string, from: string, to: string): CreatorSnapshot | null {
  let best: CreatorSnapshot | null = null;
  for (const r of rows) {
    if (r.followers == null || r.date < from || r.date > to) continue;
    if (!best || Math.abs(daysBetween(r.date, target)) < Math.abs(daysBetween(best.date, target))) best = r;
  }
  return best;
}

function engagement(media: CreatorMedia[]): number | null {
  const withViews = media.filter((m) => (m.views ?? 0) > 0).slice(0, 10);
  if (withViews.length === 0) return null;
  const views = withViews.reduce((a, m) => a + (m.views ?? 0), 0);
  const eng = withViews.reduce((a, m) => a + (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0), 0);
  return views > 0 ? eng / views : null;
}

const isVideo = (m: CreatorMedia) => m.platform === "tiktok" || /reel|video/i.test(m.mediaType ?? "");

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}
const pct = (r: number) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;

/** Everything the /stats page and Claude's get_creator_stats need, computed from stored rows. */
export async function getCreatorStats(opts: { days?: number } = {}): Promise<CreatorStats> {
  const days = Math.max(7, Math.min(365, Math.round(opts.days ?? 90)));
  const now = today();
  const from = addDays(now, -Math.max(days, 31));
  const db = await getDb();
  const s = schema.creatorSnapshots;
  const m = schema.creatorMedia;
  const [snaps, media, conns, audienceRows] = await Promise.all([
    db.select().from(s).where(gte(s.date, from)).orderBy(asc(s.date)),
    db.select().from(m).orderBy(desc(m.postedAt)).limit(400),
    db.select().from(schema.connections).where(eq(schema.connections.purpose, "creator")).orderBy(desc(schema.connections.updatedAt)),
    db.select().from(schema.creatorAudience).where(eq(schema.creatorAudience.platform, "instagram")).orderBy(desc(schema.creatorAudience.capturedAt)).limit(1),
  ]);

  const month = currentMonth();
  const platforms = {} as Record<CreatorPlatform, PlatformSummary>;
  const series = {} as CreatorStats["series"];

  for (const p of schema.CREATOR_PLATFORMS) {
    const rows = snaps.filter((r) => r.platform === p);
    const pm = media.filter((x) => x.platform === p);
    const conn = conns.find((c) => c.provider === p) ?? null;
    const latest = [...rows].reverse().find((r) => r.followers != null) ?? null;
    const change = (n: number) => {
      if (!latest || latest.followers == null) return null;
      // Only report a change when there's a reading roughly n days back (between ~0.7n and ~1.3n), so a long
      // gap in logging never passes off months of growth as "in 7 days".
      const then = followersNear(rows, addDays(latest.date, -n), addDays(latest.date, -Math.floor(n * 1.3)), addDays(latest.date, -Math.ceil(n * 0.7)));
      if (!then || then.followers == null) return null;
      return latest.followers - then.followers;
    };

    let views28: number | null = null;
    let viewsNote: string | null = null;
    const start28 = addDays(now, -27);
    const api = rows.filter((r) => r.source === "api" && r.views != null);
    if (p === "instagram") {
      const inWindow = api.filter((r) => r.date >= start28);
      if (inWindow.length > 0) {
        views28 = inWindow.reduce((a, r) => a + (r.views ?? 0), 0);
        if (inWindow.length < 25) viewsNote = `${inWindow.length} days of data so far`;
      }
    } else if (api.length >= 2) {
      const last = api[api.length - 1];
      // Base: the reading on or before 28 days back, but never more than 31 days back (a gap in video syncs
      // would otherwise turn a 60-day delta into "last 28 days"); else the oldest reading inside that window.
      const recent = api.filter((r) => r !== last && r.date >= addDays(last.date, -31));
      const base = viewsAtOrBefore(recent, addDays(last.date, -28)) ?? recent[0];
      if (base) {
        views28 = Math.max(0, (last.views ?? 0) - (base.views ?? 0));
        const span = daysBetween(base.date, last.date);
        if (span < 25) viewsNote = `over the last ${span} day${span === 1 ? "" : "s"}${base === api[0] ? ` (tracking started ${base.date})` : ""}`;
      }
    }
    if (views28 == null) {
      const manual = [...rows].reverse().find((r) => r.source === "manual" && r.views != null && r.date >= addDays(now, -31));
      if (manual) {
        views28 = manual.views;
        viewsNote = `${p === "instagram" ? "last 30 days" : "last 28 days"}, logged ${manual.date}`;
      }
    }

    const lastApi = [...rows].reverse().find((r) => r.source === "api");
    const lastMedia = pm.reduce<Date | null>((a, x) => (!a || x.updatedAt > a ? x.updatedAt : a), null);
    const lastSyncedAt = [lastApi?.updatedAt ?? null, lastMedia].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const videos = pm.filter((x) => isVideo(x) && x.views != null).slice(0, 10);
    const granted = (conn?.scopes ?? "").split(/[,\s]+/).filter(Boolean);
    const wanted = p === "tiktok" ? TIKTOK_WANTED_SCOPES : IG_CREATOR_SCOPES;

    platforms[p] = {
      platform: p,
      connected: !!conn,
      connectionLabel: conn?.label ?? null,
      connectionStatus: conn?.status ?? null,
      connectionError: conn?.lastError ?? null,
      missingScopes: conn && granted.length ? wanted.filter((w) => !granted.includes(w)) : [],
      lastSyncedAt,
      followers: latest?.followers ?? null,
      followersDate: latest?.date ?? null,
      change7: change(7),
      change30: change(30),
      views28,
      viewsNote,
      engagementRate: engagement(pm),
      avgViewsLast10: videos.length ? Math.round(videos.reduce((a, x) => a + (x.views ?? 0), 0) / videos.length) : null,
      postsThisMonth: pm.length || rows.length ? pm.filter((x) => x.postedAt && today(x.postedAt).slice(0, 7) === month).length : null,
    };
    series[p] = rows.filter((r) => r.followers != null && r.date >= addDays(now, -(days - 1))).map((r) => ({ date: r.date, followers: r.followers! }));
  }

  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const topPosts: TopPost[] = media
    .filter((x) => x.postedAt && x.postedAt >= since30)
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1))
    .slice(0, 10)
    .map((x) => ({
      id: x.id, platform: x.platform, permalink: x.permalink, thumbnailUrl: x.thumbnailUrl, caption: x.caption, mediaType: x.mediaType,
      views: x.views, reach: x.reach, likes: x.likes, comments: x.comments, shares: x.shares, saves: x.saves, clientId: x.clientId, postedAt: x.postedAt,
    }));

  const a = audienceRows[0];
  const top = (k: string, n: number) => [...(a?.data?.[k] ?? [])].sort((x, y) => y.value - x.value).slice(0, n);
  const audience = a ? { capturedAt: a.capturedAt, cities: top("city", 6), ages: [...(a.data.age ?? [])].sort((x, y) => x.key.localeCompare(y.key)), genders: top("gender", 3) } : null;

  return { today: now, platforms, series, topPosts, audience, mediaKit: buildMediaKit(platforms, audience) };
}

function viewsAtOrBefore(rows: CreatorSnapshot[], date: string): CreatorSnapshot | null {
  let best: CreatorSnapshot | null = null;
  for (const r of rows) if (r.views != null && r.date <= date) best = r;
  return best;
}

function buildMediaKit(p: Record<CreatorPlatform, PlatformSummary>, audience: CreatorStats["audience"]): CreatorStats["mediaKit"] {
  const numbers: Array<{ label: string; value: string }> = [];
  const parts: string[] = [];
  const ig = p.instagram;
  const tt = p.tiktok;
  if (ig.followers != null) numbers.push({ label: "Instagram followers", value: compact(ig.followers) });
  if (tt.followers != null) numbers.push({ label: "TikTok followers", value: compact(tt.followers) });
  const total = (ig.followers ?? 0) + (tt.followers ?? 0);
  if (ig.followers != null && tt.followers != null) parts.push(`${compact(total)} followers across Instagram (${compact(ig.followers)}) and TikTok (${compact(tt.followers)})`);
  else if (ig.followers != null) parts.push(`${compact(ig.followers)} followers on Instagram`);
  else if (tt.followers != null) parts.push(`${compact(tt.followers)} followers on TikTok`);

  if (ig.avgViewsLast10 != null) numbers.push({ label: "Avg views per reel (last 10)", value: compact(ig.avgViewsLast10) });
  if (tt.avgViewsLast10 != null) numbers.push({ label: "Avg views per TikTok (last 10)", value: compact(tt.avgViewsLast10) });
  const avg = [ig.avgViewsLast10 != null ? `${compact(ig.avgViewsLast10)} per reel` : null, tt.avgViewsLast10 != null ? `${compact(tt.avgViewsLast10)} per TikTok` : null].filter(Boolean);
  if (avg.length) parts.push(`recent videos average ${avg.join(" and ")}`);

  if (ig.engagementRate != null) numbers.push({ label: "Instagram engagement rate", value: pct(ig.engagementRate) });
  if (tt.engagementRate != null) numbers.push({ label: "TikTok engagement rate", value: pct(tt.engagementRate) });
  const best = [ig.engagementRate, tt.engagementRate].filter((x): x is number => x != null);
  if (best.length) parts.push(`with a ${pct(Math.max(...best))} engagement rate`);

  const views = (ig.views28 ?? 0) + (tt.views28 ?? 0);
  if (views > 0) numbers.push({ label: "Views, last ~28 days", value: compact(views) });

  const cities = audience?.cities.slice(0, 3).map((c) => c.key.split(",")[0].trim()) ?? [];
  if (cities.length) numbers.push({ label: "Top cities", value: cities.join(", ") });

  let text = "";
  if (parts.length) {
    text = `@noraeatsgood is a food creator with ${parts.join(", ")}.`;
    if (views > 0) text += ` Her content reached ${compact(views)} views in the last month.`;
    if (cities.length) text += ` Her audience is concentrated in ${cities.length > 1 ? `${cities.slice(0, -1).join(", ")} and ${cities[cities.length - 1]}` : cities[0]} — exactly the local diners a restaurant wants to reach.`;
  }
  return { text, numbers };
}
