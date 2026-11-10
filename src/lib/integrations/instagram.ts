import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Connection, ContentPost } from "../schema";
import { currentMonth } from "../dates";
import { notConfigured, type IntegrationResult } from "./types";
import { HttpError, errorText, fetchJson, form } from "./http";
import { findConnection, listConnectionsFor, ops, readTokens } from "./connections";
import { monthBounds } from "./time";

/**
 * Instagram API with Instagram Login (graph.instagram.com). One connection per business (clientId set).
 * Env: IG_APP_ID, IG_APP_SECRET. Optional IG_API_VERSION to move to a newer Graph version without a deploy of code.
 */
export const IG_API_VERSION = process.env.IG_API_VERSION?.trim() || "v24.0";
const GRAPH = `https://graph.instagram.com/${IG_API_VERSION}`;
export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
];
const DAY = 86_400_000;
/** Long-lived tokens last 60 days; refresh when fewer than this many days remain. */
const REFRESH_WITHIN_DAYS = 15;

type IgTokens = { accessToken: string; userId: string; issuedAt: string };

export function instagramConfigured(): boolean {
  return !!(process.env.IG_APP_ID && process.env.IG_APP_SECRET);
}

/* ───────────── OAuth ───────────── */

export function instagramAuthorizeUrl(state: string, redirectUri: string): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", process.env.IG_APP_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

/** Code → short-lived token → long-lived (60 day) token → profile. Returns what saveConnection needs. */
export async function exchangeInstagramCode(code: string, redirectUri: string) {
  const short = await fetchJson<{ access_token?: string; user_id?: string | number; permissions?: string[] | string; data?: Array<{ access_token: string; user_id: string | number; permissions?: string | string[] }> }>(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      body: form({
        client_id: process.env.IG_APP_ID, client_secret: process.env.IG_APP_SECRET,
        grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, ""),
      }),
    },
  );
  const s = short.data?.[0] ?? short;
  if (!s.access_token) throw new Error("Instagram didn't return an access token");
  const long = await fetchJson<{ access_token: string; expires_in?: number }>(
    `https://graph.instagram.com/access_token?${form({ grant_type: "ig_exchange_token", client_secret: process.env.IG_APP_SECRET, access_token: s.access_token })}`,
  );
  const me = await fetchJson<{ user_id?: string | number; id?: string; username?: string }>(
    `${GRAPH}/me?${form({ fields: "user_id,username", access_token: long.access_token })}`,
  );
  const userId = String(me.user_id ?? s.user_id ?? me.id ?? "");
  if (!userId) throw new Error("Couldn't read the Instagram account id");
  const perms = Array.isArray(s.permissions) ? s.permissions.join(",") : s.permissions ?? IG_SCOPES.join(",");
  return {
    label: me.username ? `@${me.username}` : `Instagram ${userId}`,
    externalId: userId,
    tokens: { accessToken: long.access_token, userId, issuedAt: new Date().toISOString() } satisfies IgTokens,
    scopes: perms,
    expiresAt: new Date(Date.now() + (long.expires_in ?? 60 * 86400) * 1000),
  };
}

/* ───────────── Auth for a business ───────────── */

type IgAuth = { conn: Connection; token: string; igUserId: string };

async function authFor(clientId: string): Promise<IgAuth | IntegrationResult> {
  if (!instagramConfigured()) return notConfigured("Instagram");
  const conn = await findConnection("instagram", clientId);
  if (!conn) return notConfigured("Instagram for this business");
  if (conn.status === "expired" || (conn.expiresAt && conn.expiresAt.getTime() < Date.now())) {
    return { ok: false, error: `Instagram access for ${conn.label} has expired — reconnect it in Settings.` };
  }
  const t = readTokens<IgTokens>(conn);
  if (!t?.accessToken) return { ok: false, error: "Couldn't read the saved Instagram token (check TOKEN_ENC_KEY), then reconnect in Settings." };
  return { conn, token: t.accessToken, igUserId: t.userId || conn.externalId || "me" };
}

const isAuth = (a: IgAuth | IntegrationResult): a is IgAuth => "token" in a;

/** Meta error code 190 = token invalid/expired. Flag the connection so Settings shows it. */
async function noteError(conn: Connection, e: unknown): Promise<string> {
  const msg = errorText(e);
  const body = e instanceof HttpError ? (e.body as { error?: { code?: number } } | null) : null;
  const expired = body?.error?.code === 190;
  try {
    const { setConnectionStatus } = await ops();
    await setConnectionStatus(conn.id, expired ? "expired" : "error", expired ? "Instagram token expired or was revoked — reconnect." : msg);
  } catch {
    /* bookkeeping only */
  }
  return expired ? `Instagram access for ${conn.label} expired or was revoked — reconnect it in Settings.` : msg;
}

async function igGet<T>(path: string, token: string, params: Record<string, string | number | undefined> = {}) {
  return fetchJson<T>(`${GRAPH}/${path}?${form({ ...params, access_token: token })}`);
}
async function igPost<T>(path: string, token: string, params: Record<string, string | number | boolean | undefined>) {
  return fetchJson<T>(`${GRAPH}/${path}`, { method: "POST", body: form({ ...params, access_token: token }) });
}

/* ───────────── Publishing ───────────── */

const VIDEO_RE = /\.(mp4|mov|m4v)$/i;
const JPEG_RE = /\.(jpe?g)$/i;
const OTHER_IMAGE_RE = /\.(png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;

function classify(url: string): { kind: "image" | "video" } | { error: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: `“${url}” isn't a full public URL. Upload media with Vercel Blob configured so Instagram can fetch it.` };
  }
  if (u.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(u.hostname)) {
    return { error: "Instagram can only fetch media from a public https:// URL (local uploads won't work)." };
  }
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    path = u.pathname; // malformed %-escape: classify on the raw path rather than throwing
  }
  if (VIDEO_RE.test(path)) return { kind: "video" };
  if (OTHER_IMAGE_RE.test(path)) {
    const ext = path.split(".").pop()?.toUpperCase();
    return { error: `Instagram only accepts JPEG images — convert the ${ext} file (${path.split("/").pop()}) to .jpg and re-upload.` };
  }
  if (JPEG_RE.test(path)) return { kind: "image" };
  return { kind: "image" }; // unknown extension: let Instagram decide
}

type ContainerStatus = { status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED"; status?: string };

/** Waits until every container is FINISHED. Bounded by `deadline` (ms epoch) to fit Vercel's 60s limit. */
async function waitForContainers(ids: string[], token: string, deadline: number, video: boolean): Promise<{ error: string; timedOut?: boolean } | null> {
  const pending = new Set(ids);
  while (pending.size) {
    for (const id of [...pending]) {
      const s = await igGet<ContainerStatus>(id, token, { fields: "status_code,status" });
      if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") pending.delete(id);
      else if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
        return { error: `Instagram couldn't process the media (${s.status ?? s.status_code}). Check the file format and size.` };
      }
    }
    if (!pending.size) break;
    if (Date.now() + 3000 > deadline) {
      return {
        timedOut: true,
        error: video ? "Instagram is still processing the video." : "Instagram took too long to process the media.",
      };
    }
    await new Promise((r) => setTimeout(r, video ? 3000 : 1500));
  }
  return null;
}

/** Fingerprint of what a container was built from; a saved container is only reused if the post still matches. */
function containerKey(post: ContentPost): string {
  return createHash("sha256").update(JSON.stringify([post.format, post.caption ?? "", post.mediaUrls])).digest("hex").slice(0, 32);
}

/** Give up on a container that has been processing this long (Instagram expires containers after 24h). */
const CONTAINER_MAX_AGE_MS = 2 * 60 * 60_000;

/**
 * Publishes one post. `deadline` (ms epoch) bounds the polling so the whole call fits the caller's time budget.
 * If processing outlasts it, the result carries `pendingContainer` so the next run resumes polling that same
 * container (a long reel can take minutes) instead of creating a new one and starting over.
 */
export async function publishInstagramPost(post: ContentPost, opts: { deadline?: number } = {}): Promise<IntegrationResult> {
  const auth = await authFor(post.clientId);
  if (!isAuth(auth)) return auth;
  const { token, igUserId, conn } = auth;
  const deadline = opts.deadline ?? Date.now() + 50_000;
  const urls = post.mediaUrls.filter(Boolean);
  if (urls.length === 0) return { ok: false, error: "Add at least one photo or video before publishing." };

  const media: Array<{ url: string; kind: "image" | "video" }> = [];
  for (const url of urls) {
    const c = classify(url);
    if ("error" in c) return { ok: false, error: c.error };
    media.push({ url, kind: c.kind });
  }
  const caption = post.caption ?? undefined;
  const hasVideo = media.some((m) => m.kind === "video");
  const key = containerKey(post);

  try {
    let containerId: string | undefined;
    let createdAt = new Date().toISOString();
    const saved = post.igContainer;
    if (saved && saved.key === key) {
      const age = Date.now() - Date.parse(saved.createdAt);
      const s = await igGet<ContainerStatus>(saved.id, token, { fields: "status_code,status" });
      if (s.status_code === "PUBLISHED") {
        return { ok: false, error: "Instagram says this media was already published. Check the account, then mark the post published." };
      }
      if (s.status_code === "FINISHED" || s.status_code === "IN_PROGRESS") {
        if (s.status_code === "IN_PROGRESS" && age > CONTAINER_MAX_AGE_MS) {
          return { ok: false, error: "Instagram has been processing this video for over 2 hours. Re-export it (H.264 .mp4, under 15 min / 300 MB) and schedule again, or post it by hand." };
        }
        containerId = saved.id;
        createdAt = saved.createdAt;
      }
      // ERROR / EXPIRED / unknown: fall through and build a fresh container.
    }

    if (!containerId) {
      if (post.format === "carousel" || (post.format === "feed" && media.length > 1)) {
        if (media.length < 2) return { ok: false, error: "A carousel needs at least 2 photos or videos." };
        if (media.length > 10) return { ok: false, error: "Instagram carousels allow at most 10 items." };
        const children: string[] = [];
        for (const m of media) {
          const r = await igPost<{ id: string }>(`${igUserId}/media`, token, m.kind === "video"
            ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: true }
            : { image_url: m.url, is_carousel_item: true });
          children.push(r.id);
        }
        const childErr = await waitForContainers(children, token, deadline, hasVideo);
        if (childErr) return { ok: false, error: childErr.timedOut ? `${childErr.error} Schedule it again to retry in a few minutes.` : childErr.error };
        containerId = (await igPost<{ id: string }>(`${igUserId}/media`, token, { media_type: "CAROUSEL", children: children.join(","), caption })).id;
      } else if (post.format === "story") {
        const m = media[0];
        containerId = (await igPost<{ id: string }>(`${igUserId}/media`, token, m.kind === "video"
          ? { media_type: "STORIES", video_url: m.url }
          : { media_type: "STORIES", image_url: m.url })).id;
      } else if (post.format === "reel" || post.format === "video" || media[0].kind === "video") {
        const m = media[0];
        if (m.kind !== "video") return { ok: false, error: "Reels need a video file (.mp4 or .mov)." };
        containerId = (await igPost<{ id: string }>(`${igUserId}/media`, token, { media_type: "REELS", video_url: m.url, caption, share_to_feed: true })).id;
      } else {
        containerId = (await igPost<{ id: string }>(`${igUserId}/media`, token, { image_url: media[0].url, caption })).id;
      }
    }

    const pendingContainer = { id: containerId, key, createdAt };
    const err = await waitForContainers([containerId], token, deadline, hasVideo);
    if (err) return err.timedOut ? { ok: false, error: `${err.error} It will be retried on the next publishing run.`, pendingContainer } : { ok: false, error: err.error };
    // Not enough time left to publish safely inside this run: keep the finished container for the next one.
    if (Date.now() > deadline) return { ok: false, error: "Out of time in this publishing run. It will be retried on the next run.", pendingContainer };
    const published = await igPost<{ id: string }>(`${igUserId}/media_publish`, token, { creation_id: containerId });
    let permalink: string | undefined;
    try {
      permalink = (await fetchJson<{ permalink?: string }>(`${GRAPH}/${published.id}?${form({ fields: "permalink", access_token: token })}`, { timeoutMs: 5_000 })).permalink;
    } catch {
      /* published fine; permalink is a nicety */
    }
    return { ok: true, externalId: published.id, permalink };
  } catch (e) {
    return { ok: false, error: await noteError(conn, e) };
  }
}

export async function replyToInstagramComment(args: { clientId: string; commentId: string; text: string }): Promise<IntegrationResult> {
  if (!args.clientId) return { ok: false, error: "This reply isn't linked to a business." };
  const auth = await authFor(args.clientId);
  if (!isAuth(auth)) return auth;
  try {
    const r = await igPost<{ id: string }>(`${args.commentId}/replies`, auth.token, { message: args.text });
    return { ok: true, externalId: r.id };
  } catch (e) {
    return { ok: false, error: await noteError(auth.conn, e) };
  }
}

/* ───────────── Token refresh ───────────── */

/** Refreshes long-lived tokens with < 15 days left (Instagram requires the token to be ≥ 24h old). */
export async function refreshInstagramTokens(): Promise<{ checked: number; refreshed: number; errors: string[] }> {
  const out = { checked: 0, refreshed: 0, errors: [] as string[] };
  if (!instagramConfigured()) return out;
  const { updateConnectionTokens, setConnectionStatus } = await ops();
  for (const conn of await listConnectionsFor("instagram")) {
    out.checked++;
    const t = readTokens<IgTokens>(conn);
    if (!t?.accessToken) {
      out.errors.push(`${conn.label}: can't read saved token`);
      continue;
    }
    const now = Date.now();
    const exp = conn.expiresAt?.getTime() ?? 0;
    if (exp && exp < now) {
      await setConnectionStatus(conn.id, "expired", "Token expired — reconnect in Settings.");
      out.errors.push(`${conn.label}: expired`);
      continue;
    }
    const issued = Date.parse(t.issuedAt ?? "") || conn.updatedAt.getTime();
    if ((exp && exp - now > REFRESH_WITHIN_DAYS * DAY) || now - issued < DAY) continue;
    try {
      const r = await fetchJson<{ access_token: string; expires_in?: number }>(
        `https://graph.instagram.com/refresh_access_token?${form({ grant_type: "ig_refresh_token", access_token: t.accessToken })}`,
      );
      await updateConnectionTokens(conn.id, {
        tokens: { ...t, accessToken: r.access_token, issuedAt: new Date().toISOString() },
        expiresAt: new Date(Date.now() + (r.expires_in ?? 60 * 86400) * 1000),
      });
      out.refreshed++;
    } catch (e) {
      out.errors.push(`${conn.label}: ${await noteError(conn, e)}`);
    }
  }
  return out;
}

/* ───────────── Monthly views ───────────── */

type InsightRow = { name: string; total_value?: { value?: number }; values?: Array<{ value?: number }> };

function sumInsight(rows: InsightRow[] | undefined, name: string): number | null {
  const row = rows?.find((r) => r.name === name);
  if (!row) return null;
  if (row.total_value?.value != null) return row.total_value.value;
  if (row.values?.length) return row.values.reduce((a, v) => a + (v.value ?? 0), 0);
  return null;
}

/**
 * Pulls account-level "views" (Instagram's replacement for impressions) and total interactions for a month,
 * plus the follower count for the current month, and stores them as API metrics. Instagram caps an insights
 * window at 30 days, so a month is fetched in two halves and summed.
 */
export async function syncInstagramMonthlyViews(clientId: string, month: string): Promise<{ ok: boolean; views?: number; error?: string; notConfigured?: boolean }> {
  const auth = await authFor(clientId);
  if (!isAuth(auth)) return { ok: false, error: auth.ok ? undefined : auth.error, notConfigured: !auth.ok && auth.notConfigured };
  const { token, igUserId, conn } = auth;
  const { start, end } = monthBounds(month);
  const now = new Date();
  if (start > now) return { ok: false, error: "That month hasn't started yet." };
  const until = end < now ? end : now;

  // ≤ 30-day windows
  const windows: Array<[Date, Date]> = [];
  for (let s = start; s < until; ) {
    const e = new Date(Math.min(until.getTime(), s.getTime() + 15 * DAY));
    windows.push([s, e]);
    s = e;
  }

  try {
    let views = 0;
    let interactions: number | null = 0;
    for (const [s, e] of windows) {
      if (e.getTime() - s.getTime() < 60_000) continue;
      const params = { period: "day", metric_type: "total_value", since: Math.floor(s.getTime() / 1000), until: Math.floor(e.getTime() / 1000) };
      let rows: InsightRow[] | undefined;
      try {
        rows = (await igGet<{ data?: InsightRow[] }>(`${igUserId}/insights`, token, { metric: "views,total_interactions", ...params })).data;
      } catch (err) {
        if (err instanceof HttpError && (err.body as { error?: { code?: number } } | null)?.error?.code === 190) throw err;
        rows = (await igGet<{ data?: InsightRow[] }>(`${igUserId}/insights`, token, { metric: "views", ...params })).data;
        interactions = null;
      }
      views += sumInsight(rows, "views") ?? 0;
      if (interactions !== null) {
        const i = sumInsight(rows, "total_interactions");
        interactions = i == null ? null : interactions + i;
      }
    }

    let followers: number | null = null;
    if (month === currentMonth()) {
      try {
        followers = (await igGet<{ followers_count?: number }>(igUserId, token, { fields: "followers_count" })).followers_count ?? null;
      } catch {
        /* optional */
      }
    }

    // upsertMetric overwrites every column, so carry over anything we didn't fetch (e.g. manual reach).
    const db = await getDb();
    const m = schema.monthlyMetrics;
    const [cur] = await db.select().from(m).where(and(eq(m.clientId, clientId), eq(m.month, month), eq(m.platform, "instagram")));
    const { upsertMetric, setConnectionStatus } = await ops();
    await upsertMetric({
      clientId, month, platform: "instagram", source: "api",
      views,
      reach: cur?.reach ?? null,
      followers: followers ?? cur?.followers ?? null,
      engagements: interactions ?? cur?.engagements ?? null,
    }, "system");
    if (conn.status !== "ok") await setConnectionStatus(conn.id, "ok", null);
    return { ok: true, views };
  } catch (e) {
    return { ok: false, error: await noteError(conn, e) };
  }
}

/** Syncs views for every business with an Instagram connection, for each of `months`. */
export async function syncAllInstagramViews(months: string[]): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const out = { synced: 0, skipped: 0, errors: [] as string[] };
  if (!instagramConfigured()) return out;
  const db = await getDb();
  const rows = await db
    .select({ clientId: schema.connections.clientId, label: schema.connections.label, status: schema.connections.status })
    .from(schema.connections)
    .where(and(eq(schema.connections.provider, "instagram"), isNotNull(schema.connections.clientId)));
  for (const r of rows) {
    if (!r.clientId) continue;
    if (r.status === "expired") {
      out.skipped++;
      continue;
    }
    for (const month of months) {
      const res = await syncInstagramMonthlyViews(r.clientId, month);
      if (res.ok) out.synced++;
      else out.errors.push(`${r.label} ${month}: ${res.error}`);
    }
  }
  return out;
}
