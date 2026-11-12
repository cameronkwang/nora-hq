import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { desc, eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import { APP_TZ, today } from "../dates";
import type { Connection } from "../schema";
import { HttpError, errorText, fetchJson, form } from "./http";
import { ops, readTokens } from "./connections";
import { IG_API_VERSION, exchangeInstagramCode, instagramConfigured } from "./instagram";
import { STATE_MAX_AGE } from "./oauth";
import {
  IG_CREATOR_SCOPES, addDays, findCreatorConnection, lastAudienceAt, saveAudience, saveCreatorConnection, upsertMedia, upsertSnapshot,
  type MediaRowInput,
} from "../ops-creator";

/**
 * Nora's own Instagram (@noraeatsgood) — read-only stats via the Instagram API with Instagram Login.
 * Same Meta app as the businesses (IG_APP_ID / IG_APP_SECRET); stored as a connection with purpose "creator"
 * and no business. Token refresh is handled by the existing refreshInstagramTokens() (it renews every
 * Instagram connection). Only asks for the two read scopes.
 */

const GRAPH = `https://graph.instagram.com/${IG_API_VERSION}`;
const DAY = 86_400_000;
type IgTokens = { accessToken: string; userId: string; issuedAt: string };
export type CreatorSyncResult = { ok: boolean; notConfigured?: boolean; error?: string; warnings?: string[]; followers?: number | null; media?: number; audience?: boolean };

/* ───────────── Creator OAuth state (Instagram creator + TikTok) ─────────────
 * Mirrors lib/integrations/oauth.ts (JWT state + httpOnly nonce cookie) but signs with a different key
 * prefix, so a creator state can never be mistaken for a business connection and vice versa. */

export type CreatorOAuthProvider = "instagram" | "tiktok";
export type CreatorState = { provider: CreatorOAuthProvider; nonce: string; user: string };

function stateSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "dev-only-insecure-secret-change-me" : "");
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(`creator-oauth-state:${s}`);
}

export async function createCreatorState(input: { provider: CreatorOAuthProvider; user: string }): Promise<{ state: string; nonce: string }> {
  const nonce = randomBytes(16).toString("base64url");
  const state = await new SignJWT({ p: input.provider, n: nonce, k: "creator" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.user)
    .setIssuedAt()
    .setExpirationTime(`${STATE_MAX_AGE}s`)
    .sign(stateSecret());
  return { state, nonce };
}

export async function verifyCreatorState(state: string | null, cookieNonce: string | undefined): Promise<CreatorState | null> {
  if (!state || !cookieNonce) return null;
  try {
    const { payload } = await jwtVerify(state, stateSecret());
    const p = payload.p;
    if ((p !== "instagram" && p !== "tiktok") || payload.k !== "creator" || payload.n !== cookieNonce || !payload.sub) return null;
    return { provider: p, nonce: cookieNonce, user: payload.sub };
  } catch {
    return null;
  }
}

/* ───────────── Connect ───────────── */

export function creatorInstagramAuthorizeUrl(state: string, redirectUri: string): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", process.env.IG_APP_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_CREATOR_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

/** Callback: exchange the code and store it as Nora's creator account. Returns the @handle. */
export async function connectCreatorInstagram(code: string, redirectUri: string, actor: string): Promise<string> {
  const c = await exchangeInstagramCode(code, redirectUri);
  // exchangeInstagramCode falls back to the business scope list when Instagram doesn't echo permissions.
  const scopes = c.scopes.split(",").filter((s) => IG_CREATOR_SCOPES.includes(s)).join(",") || IG_CREATOR_SCOPES.join(",");
  await saveCreatorConnection({ provider: "instagram", label: c.label, externalId: c.externalId, tokens: c.tokens, scopes, expiresAt: c.expiresAt }, actor);
  return c.label;
}

/* ───────────── Helpers ───────────── */

async function igGet<T>(path: string, token: string, params: Record<string, string | number | undefined> = {}) {
  return fetchJson<T>(`${GRAPH}/${path}?${form({ ...params, access_token: token })}`, { timeoutMs: 15_000 });
}

const isTokenError = (e: unknown) => e instanceof HttpError && (e.body as { error?: { code?: number } } | null)?.error?.code === 190;

async function noteStatus(conn: Connection, e: unknown | null): Promise<string | null> {
  try {
    const { setConnectionStatus } = await ops();
    if (!e) {
      if (conn.status !== "ok") await setConnectionStatus(conn.id, "ok", null);
      return null;
    }
    const expired = isTokenError(e);
    await setConnectionStatus(conn.id, expired ? "expired" : "error", expired ? "Instagram token expired or was revoked — reconnect." : errorText(e));
    return expired ? "Nora's Instagram access expired or was revoked — reconnect it on My stats." : errorText(e);
  } catch {
    return e ? errorText(e) : null;
  }
}

/** Milliseconds APP_TZ is ahead of UTC at instant t. */
function tzOffsetMs(t: number): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(t / 1000) * 1000;
}

/** Local midnight of `date` (YYYY-MM-DD) in APP_TZ, as epoch ms. */
export function localDayStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess);
  t = guess - tzOffsetMs(t);
  return t;
}

type InsightRow = {
  name: string;
  total_value?: { value?: number; breakdowns?: Array<{ dimension_keys?: string[]; results?: Array<{ dimension_values?: string[]; value?: number }> }> };
  values?: Array<{ value?: number | Record<string, number>; end_time?: string }>;
};

function totalOf(rows: InsightRow[] | undefined, name: string): number | null {
  const row = rows?.find((r) => r.name === name);
  if (!row) return null;
  if (typeof row.total_value?.value === "number") return row.total_value.value;
  if (row.values?.length) return row.values.reduce((a, v) => a + (typeof v.value === "number" ? v.value : 0), 0);
  return null;
}

/* ───────────── Sync ───────────── */

const ACCOUNT_METRICS: Array<{ metric: string; field: "views" | "reach" | "profileViews" | "interactions" }> = [
  { metric: "views", field: "views" },
  { metric: "reach", field: "reach" },
  { metric: "profile_views", field: "profileViews" },
  { metric: "total_interactions", field: "interactions" },
];
const MEDIA_LIMIT = 50;
/** Heavy parts (daily flows, media insights) run at most this often unless forced — the cron is hourly. */
const HEAVY_EVERY_MS = 6 * 3600_000;

async function lastMediaUpdate(): Promise<Date | null> {
  const db = await getDb();
  const [row] = await db.select({ at: schema.creatorMedia.updatedAt }).from(schema.creatorMedia)
    .where(eq(schema.creatorMedia.platform, "instagram")).orderBy(desc(schema.creatorMedia.updatedAt)).limit(1);
  return row?.at ?? null;
}

async function hasSnapshot(date: string): Promise<boolean> {
  const db = await getDb();
  const s = schema.creatorSnapshots;
  const [row] = await db.select({ v: s.views }).from(s).where(and(eq(s.platform, "instagram"), eq(s.date, date), eq(s.source, "api")));
  return row?.v != null;
}

/** Runs `fn` over items with limited concurrency, stopping new work after `deadline`. */
async function pool<T>(items: T[], n: number, deadline: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && Date.now() < deadline) await fn(items[i++]);
  }));
}

/**
 * Daily snapshot (followers etc.), per-day account insights for the last 3 days, the last ~50 posts' stats,
 * and the audience breakdown weekly. Each piece fails alone; only a token error stops the run.
 */
export async function syncCreatorInstagram(opts: { force?: boolean; deadline?: number } = {}): Promise<CreatorSyncResult> {
  if (!instagramConfigured()) return { ok: false, notConfigured: true, error: "Instagram isn't set up (IG_APP_ID / IG_APP_SECRET)." };
  const conn = await findCreatorConnection("instagram");
  if (!conn) return { ok: false, notConfigured: true, error: "Nora's Instagram isn't connected yet (My stats → Connect Instagram)." };
  if (conn.status === "expired" || (conn.expiresAt && conn.expiresAt.getTime() < Date.now())) {
    return { ok: false, error: "Nora's Instagram access has expired — reconnect it on My stats." };
  }
  const t = readTokens<IgTokens>(conn);
  if (!t?.accessToken) return { ok: false, error: "Couldn't read the saved Instagram token (check TOKEN_ENC_KEY), then reconnect." };
  const token = t.accessToken;
  const uid = t.userId || conn.externalId || "me";
  const deadline = opts.deadline ?? Date.now() + 45_000;
  const warnings: string[] = [];
  const day = today();

  try {
    // 1. Current totals. Fails loudly: if this doesn't work nothing else will.
    const me = await igGet<{ followers_count?: number; follows_count?: number; media_count?: number; username?: string }>("me", token, {
      fields: "user_id,username,followers_count,follows_count,media_count",
    });
    await upsertSnapshot("instagram", day, { followers: me.followers_count ?? null, following: me.follows_count ?? null, posts: me.media_count ?? null }, "api", "system");

    const lastMedia = await lastMediaUpdate();
    const heavy = opts.force || !lastMedia || Date.now() - lastMedia.getTime() > HEAVY_EVERY_MS || !(await hasSnapshot(addDays(day, -1)));

    let mediaCount = 0;
    let audienceSaved = false;
    if (heavy) {
      // 2. Per-day account insights for the 2 complete days before today, plus today so far. One metric per call.
      for (const d of [addDays(day, -2), addDays(day, -1), day]) {
        if (Date.now() > deadline - 20_000) break;
        const since = Math.floor(localDayStart(d) / 1000);
        const until = Math.min(Math.floor(localDayStart(addDays(d, 1)) / 1000), Math.floor(Date.now() / 1000) - 60);
        if (until <= since) continue;
        const vals: Record<string, number | null> = {};
        for (const { metric, field } of ACCOUNT_METRICS) {
          try {
            const r = await igGet<{ data?: InsightRow[] }>(`${uid}/insights`, token, { metric, period: "day", metric_type: "total_value", since, until });
            vals[field] = totalOf(r.data, metric);
          } catch (e) {
            if (isTokenError(e)) throw e;
            if (d === day) warnings.push(`${metric}: ${errorText(e)}`);
          }
        }
        if (Object.keys(vals).length) await upsertSnapshot("instagram", d, vals, "api", "system");
      }

      // 3. Gross new follows per day (follower_count; needs ≥100 followers; last ~30 days only).
      try {
        const since = Math.floor(localDayStart(addDays(day, -3)) / 1000);
        const r = await igGet<{ data?: InsightRow[] }>(`${uid}/insights`, token, { metric: "follower_count", period: "day", since, until: Math.floor(Date.now() / 1000) });
        for (const v of r.data?.find((x) => x.name === "follower_count")?.values ?? []) {
          if (typeof v.value !== "number" || !v.end_time) continue;
          // end_time marks the end of the day the value covers; step back 12h to land inside that day.
          const d = today(new Date(Date.parse(v.end_time) - 12 * 3600_000));
          if (d <= day) await upsertSnapshot("instagram", d, { newFollows: v.value }, "api", "system");
        }
      } catch (e) {
        if (isTokenError(e)) throw e;
        warnings.push(`follower_count: ${errorText(e)}`);
      }

      // 4. Recent posts + per-post insights.
      if (Date.now() < deadline - 10_000) {
        try {
          mediaCount = await syncMedia(uid, token, deadline, warnings);
        } catch (e) {
          if (isTokenError(e)) throw e;
          warnings.push(`posts: ${errorText(e)}`);
        }
      }

      // 5. Audience, weekly.
      const lastAud = await lastAudienceAt("instagram");
      if ((opts.force || !lastAud || Date.now() - lastAud.getTime() > 6 * DAY) && Date.now() < deadline - 5_000) {
        audienceSaved = await syncAudience(uid, token, warnings);
      }
    }

    await noteStatus(conn, null);
    return { ok: true, followers: me.followers_count ?? null, media: mediaCount, audience: audienceSaved, ...(warnings.length ? { warnings: warnings.slice(0, 10) } : {}) };
  } catch (e) {
    return { ok: false, error: (await noteStatus(conn, e)) ?? errorText(e) };
  }
}

type IgMedia = {
  id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string; thumbnail_url?: string; media_url?: string;
  timestamp?: string; like_count?: number; comments_count?: number;
};

function mediaKind(m: IgMedia): string {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (m.media_type === "VIDEO") return "video";
  return "image";
}

const MEDIA_METRICS = ["views", "reach", "saved", "shares", "total_interactions"] as const;

async function syncMedia(uid: string, token: string, deadline: number, warnings: string[]): Promise<number> {
  const items: IgMedia[] = [];
  let after: string | undefined;
  while (items.length < MEDIA_LIMIT) {
    const page = await igGet<{ data?: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${uid}/media`, token, {
      fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
      limit: 25,
      after,
    });
    items.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
    if (!after || !page.data?.length) break;
  }

  const rows: MediaRowInput[] = [];
  let failed = 0;
  await pool(items.slice(0, MEDIA_LIMIT), 5, deadline - 3_000, async (m) => {
    const vals: Partial<Record<(typeof MEDIA_METRICS)[number], number | null>> = {};
    try {
      const r = await igGet<{ data?: InsightRow[] }>(`${m.id}/insights`, token, { metric: MEDIA_METRICS.join(",") });
      for (const k of MEDIA_METRICS) vals[k] = totalOf(r.data, k);
    } catch (e) {
      if (isTokenError(e)) throw e;
      // One unsupported metric fails the whole call (e.g. older posts): retry one metric at a time.
      for (const k of MEDIA_METRICS) {
        try {
          const r = await igGet<{ data?: InsightRow[] }>(`${m.id}/insights`, token, { metric: k });
          vals[k] = totalOf(r.data, k);
        } catch {
          /* this metric isn't available for this post */
        }
      }
      if (Object.values(vals).every((v) => v == null)) failed++;
    }
    const isVid = m.media_type === "VIDEO";
    rows.push({
      externalId: m.id,
      permalink: m.permalink ?? null,
      thumbnailUrl: (isVid ? m.thumbnail_url : m.media_url ?? m.thumbnail_url) ?? null,
      caption: m.caption ?? null,
      mediaType: mediaKind(m),
      postedAt: m.timestamp ? new Date(m.timestamp) : null,
      views: vals.views ?? null,
      reach: vals.reach ?? null,
      likes: m.like_count ?? null,
      comments: m.comments_count ?? null,
      shares: vals.shares ?? null,
      saves: vals.saved ?? null,
    });
  });
  if (failed) warnings.push(`insights unavailable for ${failed} post${failed === 1 ? "" : "s"}`);
  return upsertMedia("instagram", rows, "system");
}

type DemoRow = { name: string; total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> } };

/** follower_demographics (falls back to engaged_audience_demographics), one breakdown per call, tolerant of timeframe changes. */
async function syncAudience(uid: string, token: string, warnings: string[]): Promise<boolean> {
  const data: Record<string, Array<{ key: string; value: number }>> = {};
  for (const breakdown of ["city", "age", "gender"] as const) {
    let got: Array<{ key: string; value: number }> | null = null;
    let lastErr: unknown = null;
    outer: for (const metric of ["follower_demographics", "engaged_audience_demographics"]) {
      for (const timeframe of ["this_month", "last_30_days", "last_90_days", undefined]) {
        try {
          const r = await igGet<{ data?: DemoRow[] }>(`${uid}/insights`, token, { metric, period: "lifetime", metric_type: "total_value", breakdown, timeframe });
          const results = r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
          got = results
            .map((x) => ({ key: (x.dimension_values ?? []).join(" / ") || "Unknown", value: Number(x.value ?? 0) }))
            .filter((x) => x.value > 0);
          if (got.length) break outer;
        } catch (e) {
          if (isTokenError(e)) throw e;
          lastErr = e;
        }
      }
    }
    if (got?.length) data[breakdown] = got.sort((a, b) => b.value - a.value).slice(0, 50);
    else if (lastErr) warnings.push(`audience ${breakdown}: ${errorText(lastErr)}`);
  }
  if (!Object.keys(data).length) return false;
  await saveAudience("instagram", data, "system");
  return true;
}
