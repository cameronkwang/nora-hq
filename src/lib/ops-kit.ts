import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { getCreatorClient } from "./data";
import { getCreatorStats } from "./ops-creator";
import { KIT_DEFAULTS, type KitIdentity, type KitStats, type MediaKitSettings } from "@/components/kit-view";

/**
 * Nora's public media kit (/kit). Settings live in app_settings key "media_kit"; the numbers always come
 * live from getCreatorStats, so the kit never goes stale or shows a number someone typed in.
 * Only a signed-in person changes the settings (actor = user email); Claude has no tool for this.
 */

export const MEDIA_KIT_KEY = "media_kit";

const Actor = z.string().trim().min(1).max(200);
const text = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLen: number) =>
  z.array(z.string().trim().max(maxLen)).max(maxItems).transform((a) => [...new Set(a.filter(Boolean))]);

export const MediaKitInput = z.object({
  headline: text(140),
  bio: text(800),
  rateLine: text(300),
  showRate: z.boolean(),
  showPastCollabs: z.boolean(),
  pastCollabs: list(30, 80),
  contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().max(200).pipe(z.email("That contact email doesn't look right."))]),
  showCities: z.boolean(),
  styles: list(12, 40),
});
export type MediaKitInputT = z.input<typeof MediaKitInput>;

/** Stored value merged over the defaults, so a field added later never reads as undefined. */
function normalize(raw: Record<string, unknown> | null | undefined): MediaKitSettings {
  const v = raw ?? {};
  const str = (k: keyof MediaKitSettings) => (typeof v[k] === "string" ? (v[k] as string) : (KIT_DEFAULTS[k] as string));
  const bool = (k: keyof MediaKitSettings) => (typeof v[k] === "boolean" ? (v[k] as boolean) : (KIT_DEFAULTS[k] as boolean));
  const arr = (k: keyof MediaKitSettings) => (Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is string => typeof x === "string") : (KIT_DEFAULTS[k] as string[]));
  return {
    enabled: bool("enabled"),
    headline: str("headline"),
    bio: str("bio"),
    rateLine: str("rateLine"),
    showRate: bool("showRate"),
    showPastCollabs: bool("showPastCollabs"),
    pastCollabs: arr("pastCollabs"),
    contactEmail: str("contactEmail"),
    showCities: bool("showCities"),
    styles: arr("styles"),
  };
}

export async function getMediaKitSettings(): Promise<MediaKitSettings & { updatedAt: Date | null; updatedBy: string | null }> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, MEDIA_KIT_KEY));
  return { ...normalize(row?.value), updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
}

async function write(value: MediaKitSettings, actor: string) {
  const db = await getDb();
  const now = new Date();
  await db.insert(schema.appSettings).values({ key: MEDIA_KIT_KEY, value, updatedBy: actor, updatedAt: now })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: actor, updatedAt: now } });
}

/**
 * Saves the kit's words and toggles. `publish` true/false also flips whether /kit is live; undefined keeps it.
 * Only people: Claude never edits the public kit.
 */
export async function saveMediaKitSettings(input: MediaKitInputT, actor: string, publish?: boolean) {
  const a = Actor.parse(actor);
  if (a === "claude" || a === "system" || a === "public") throw new OpsError("Only Nora or Cameron can change the media kit.");
  const v = MediaKitInput.parse(input);
  const cur = await getMediaKitSettings();
  const enabled = publish ?? cur.enabled;
  const next: MediaKitSettings = { ...v, enabled };
  await write(next, a);
  const what = publish === true && !cur.enabled ? "Published the media kit" : publish === false && cur.enabled ? "Unpublished the media kit" : "Updated the media kit";
  await logActivity({ actor: a, action: publish === undefined ? "media_kit.updated" : publish ? "media_kit.published" : "media_kit.unpublished", entityType: "app_settings", entityId: MEDIA_KIT_KEY, summary: what });
  return next;
}

/** The numbers the kit shows, from the same read model as My stats. */
export async function getKitStats(): Promise<KitStats> {
  const s = await getCreatorStats({ days: 35 });
  const ig = s.platforms.instagram;
  const tt = s.platforms.tiktok;
  const asOf = [ig.followersDate, tt.followersDate].filter((d): d is string => !!d).sort().pop() ?? null;
  return {
    igFollowers: ig.followers,
    ttFollowers: tt.followers,
    igAvgViews: ig.avgViewsLast10,
    ttAvgViews: tt.avgViewsLast10,
    igEngagement: ig.engagementRate,
    ttEngagement: tt.engagementRate,
    cities: s.audience?.cities.slice(0, 3).map((c) => c.key.split(",")[0].trim()).filter(Boolean) ?? [],
    asOf,
  };
}

export async function getKitIdentity(): Promise<KitIdentity> {
  const c = await getCreatorClient();
  return { name: c?.name?.trim() || "Nora", igHandle: c?.instagramHandle ?? "noraeatsgood", ttHandle: c?.tiktokHandle ?? null };
}

/** Everything /kit renders, or null when the kit is unpublished (the page 404s). */
export async function getPublicKit(): Promise<{ settings: MediaKitSettings; stats: KitStats; identity: KitIdentity } | null> {
  const settings = await getMediaKitSettings();
  if (!settings.enabled) return null;
  const [stats, identity] = await Promise.all([getKitStats(), getKitIdentity()]);
  return { settings, stats, identity };
}

/** Is the rate line on? Used by the public /collab page (works whether or not the kit itself is published). */
export async function getPublicRateInfo(): Promise<{ rateLine: string | null; kitLive: boolean }> {
  const s = await getMediaKitSettings();
  return { rateLine: s.showRate && s.rateLine.trim() ? s.rateLine.trim() : null, kitLive: s.enabled };
}

/**
 * Business names Nora could list under "Past collabs": deals that were posted/completed, then businesses she
 * manages. Nothing is shown publicly until she ticks it.
 */
export async function pastCollabCandidates(): Promise<string[]> {
  const db = await getDb();
  const [deals, clients] = await Promise.all([
    db.select({ name: schema.deals.businessName }).from(schema.deals).where(inArray(schema.deals.status, ["posted", "complete"])).orderBy(asc(schema.deals.businessName)),
    db.select({ name: schema.clients.name, kind: schema.clients.kind }).from(schema.clients).where(eq(schema.clients.archived, false)).orderBy(asc(schema.clients.name)),
  ]);
  const names = [...deals.map((d) => d.name), ...clients.filter((c) => c.kind !== "creator").map((c) => c.name)];
  return [...new Set(names.map((n) => n?.trim()).filter((n): n is string => !!n))].slice(0, 40);
}
