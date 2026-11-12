import "server-only";
import { eq, sum } from "drizzle-orm";
import { getDb, schema } from "../db";
import { today } from "../dates";
import type { Connection } from "../schema";
import { HttpError, errorText, fetchJson, form } from "./http";
import { ops, readTokens } from "./connections";
import { TIKTOK_WANTED_SCOPES, findCreatorConnection, saveCreatorConnection, upsertMedia, upsertSnapshot, type MediaRowInput } from "../ops-creator";
import type { CreatorSyncResult } from "./creator-instagram";

/**
 * Nora's TikTok (@noraeatsgood) via Login Kit v2 + Display API (read-only).
 * Env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET. Access tokens last ~24h, refresh tokens ~365 days; we refresh
 * right before each use. TikTok offers no audience/reach/views-over-time here: views-over-time comes from the
 * daily snapshot of summed per-video view counts.
 */

const API = "https://open.tiktokapis.com/v2";
const DAY = 86_400_000;
const VIDEO_LIMIT = 60;

type TtTokens = { accessToken: string; refreshToken: string; openId: string; accessExpiresAt: string; refreshExpiresAt: string };
type TokenResponse = {
  access_token?: string; expires_in?: number; open_id?: string; refresh_token?: string; refresh_expires_in?: number; scope?: string;
  error?: string; error_description?: string;
};
type TtEnvelope<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string } };

export function tiktokConfigured(): boolean {
  return !!(process.env.TIKTOK_CLIENT_KEY?.trim() && process.env.TIKTOK_CLIENT_SECRET?.trim());
}

export function tiktokAuthorizeUrl(state: string, redirectUri: string): string {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY?.trim() ?? "");
  u.searchParams.set("scope", TIKTOK_WANTED_SCOPES.join(","));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenCall(params: Record<string, string>): Promise<TokenResponse> {
  const r = await fetchJson<TokenResponse>(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: form({ client_key: process.env.TIKTOK_CLIENT_KEY?.trim(), client_secret: process.env.TIKTOK_CLIENT_SECRET?.trim(), ...params }),
  });
  // TikTok can answer 200 with an error body.
  if (r.error || !r.access_token) throw new HttpError(r.error_description || r.error || "TikTok didn't return an access token", 400, r);
  return r;
}

function toTokens(r: TokenResponse, prev?: TtTokens): TtTokens {
  const now = Date.now();
  return {
    accessToken: r.access_token!,
    refreshToken: r.refresh_token ?? prev?.refreshToken ?? "",
    openId: r.open_id ?? prev?.openId ?? "",
    accessExpiresAt: new Date(now + (r.expires_in ?? 86_400) * 1000).toISOString(),
    refreshExpiresAt: r.refresh_expires_in ? new Date(now + r.refresh_expires_in * 1000).toISOString() : prev?.refreshExpiresAt ?? new Date(now + 365 * DAY).toISOString(),
  };
}

function checkEnvelope<T>(r: TtEnvelope<T>, what: string): T {
  const code = r.error?.code;
  if (code && code !== "ok") throw new HttpError(`TikTok ${what}: ${r.error?.message || code}${r.error?.log_id ? ` (log ${r.error.log_id})` : ""}`, 400, r);
  if (!r.data) throw new HttpError(`TikTok ${what}: empty response`, 500, r);
  return r.data;
}

type TtUser = { open_id?: string; display_name?: string; username?: string; avatar_url?: string; follower_count?: number; following_count?: number; likes_count?: number; video_count?: number };

async function getUser(token: string, fields: string): Promise<TtUser> {
  const r = await fetchJson<TtEnvelope<{ user?: TtUser }>>(`${API}/user/info/?${form({ fields })}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 });
  return checkEnvelope(r, "user info").user ?? {};
}

/** Callback: code → tokens → profile; stores Nora's TikTok. Returns label + any scopes she declined. */
export async function connectCreatorTikTok(code: string, redirectUri: string, actor: string): Promise<{ label: string; missingScopes: string[] }> {
  const r = await tokenCall({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const tokens = toTokens(r);
  const granted = (r.scope ?? "").split(/[,\s]+/).filter(Boolean);
  let label = "TikTok";
  try {
    const u = await getUser(tokens.accessToken, granted.includes("user.info.profile") ? "open_id,display_name,username" : "open_id,display_name");
    label = u.username ? `@${u.username}` : u.display_name || label;
  } catch {
    /* label is cosmetic */
  }
  if (!tokens.openId) throw new Error("TikTok didn't return an account id");
  await saveCreatorConnection({
    provider: "tiktok", label, externalId: tokens.openId, tokens, scopes: granted.join(",") || null, expiresAt: new Date(tokens.refreshExpiresAt),
  }, actor);
  return { label, missingScopes: granted.length ? TIKTOK_WANTED_SCOPES.filter((s) => !granted.includes(s)) : [] };
}

/** Returns a fresh access token, refreshing (and saving) when it has < 1h left. */
async function freshToken(conn: Connection): Promise<string> {
  const t = readTokens<TtTokens>(conn);
  if (!t?.accessToken) throw new Error("Couldn't read the saved TikTok token (check TOKEN_ENC_KEY), then reconnect.");
  if (Date.parse(t.accessExpiresAt) - Date.now() > 3600_000) return t.accessToken;
  if (!t.refreshToken || Date.parse(t.refreshExpiresAt) < Date.now()) throw new HttpError("TikTok login expired — reconnect on My stats.", 401, { error: "invalid_grant" });
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refreshToken });
  const next = toTokens(r, t);
  const { updateConnectionTokens } = await ops();
  await updateConnectionTokens(conn.id, { tokens: next, expiresAt: new Date(next.refreshExpiresAt) });
  return next.accessToken;
}

const isAuthError = (e: unknown) => {
  if (!(e instanceof HttpError)) return false;
  const b = e.body as { error?: string | { code?: string } } | null;
  const code = typeof b?.error === "string" ? b.error : b?.error?.code;
  return e.status === 401 || code === "invalid_grant" || code === "access_token_invalid";
};

type TtVideo = {
  id: string; title?: string; video_description?: string; create_time?: number; cover_image_url?: string; share_url?: string;
  view_count?: number; like_count?: number; comment_count?: number; share_count?: number;
};

async function listVideos(token: string): Promise<TtVideo[]> {
  const fields = "id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count";
  const out: TtVideo[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < 5 && out.length < VIDEO_LIMIT; page++) {
    const r = await fetchJson<TtEnvelope<{ videos?: TtVideo[]; cursor?: number; has_more?: boolean }>>(`${API}/video/list/?${form({ fields })}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
      timeoutMs: 15_000,
    });
    const d = checkEnvelope(r, "video list");
    out.push(...(d.videos ?? []));
    if (!d.has_more || !d.cursor) break;
    cursor = d.cursor;
  }
  return out.slice(0, VIDEO_LIMIT);
}

/** Today's snapshot (followers, likes, videos, summed video views) + latest per-video stats. */
export async function syncCreatorTikTok(_opts: { force?: boolean; deadline?: number } = {}): Promise<CreatorSyncResult> {
  if (!tiktokConfigured()) return { ok: false, notConfigured: true, error: "TikTok isn't set up (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET)." };
  const conn = await findCreatorConnection("tiktok");
  if (!conn) return { ok: false, notConfigured: true, error: "Nora's TikTok isn't connected yet (My stats → Connect TikTok)." };
  if (conn.status === "expired") return { ok: false, error: "Nora's TikTok login expired — reconnect it on My stats." };
  const { setConnectionStatus } = await ops();
  const granted = (conn.scopes ?? "").split(/[,\s]+/).filter(Boolean);
  const has = (s: string) => granted.length === 0 || granted.includes(s);
  const warnings: string[] = [];
  const missing = TIKTOK_WANTED_SCOPES.filter((s) => !has(s));
  if (missing.length) warnings.push(`Not allowed during sign-in: ${missing.join(", ")} — reconnect and allow them for full stats.`);
  const day = today();

  try {
    const token = await freshToken(conn);
    const fields = ["open_id", "display_name", ...(has("user.info.stats") ? ["follower_count", "following_count", "likes_count", "video_count"] : [])].join(",");
    const u = await getUser(token, fields);

    let mediaCount = 0;
    if (has("video.list")) {
      try {
        const videos = await listVideos(token);
        const rows: MediaRowInput[] = videos.map((v) => ({
          externalId: v.id,
          permalink: v.share_url ?? null,
          thumbnailUrl: v.cover_image_url ?? null,
          caption: v.video_description || v.title || null,
          mediaType: "video",
          postedAt: v.create_time ? new Date(v.create_time * 1000) : null,
          views: v.view_count ?? null,
          likes: v.like_count ?? null,
          comments: v.comment_count ?? null,
          shares: v.share_count ?? null,
        }));
        mediaCount = await upsertMedia("tiktok", rows, "system");
      } catch (e) {
        if (isAuthError(e)) throw e;
        warnings.push(`videos: ${errorText(e)}`);
      }
    }

    // Views = summed lifetime views of every tracked video; the UI turns consecutive days into deltas.
    let views: number | null | undefined;
    if (mediaCount > 0) {
      const db = await getDb();
      const [row] = await db.select({ total: sum(schema.creatorMedia.views) }).from(schema.creatorMedia).where(eq(schema.creatorMedia.platform, "tiktok"));
      views = row?.total != null ? Number(row.total) : null;
    }

    await upsertSnapshot("tiktok", day, {
      followers: u.follower_count ?? null,
      following: u.following_count ?? null,
      likesTotal: u.likes_count ?? null,
      posts: u.video_count ?? null,
      ...(views !== undefined ? { views } : {}),
    }, "api", "system");
    if (conn.status !== "ok") await setConnectionStatus(conn.id, "ok", null);
    return { ok: true, followers: u.follower_count ?? null, media: mediaCount, ...(warnings.length ? { warnings } : {}) };
  } catch (e) {
    const expired = isAuthError(e);
    const msg = errorText(e);
    try {
      await setConnectionStatus(conn.id, expired ? "expired" : "error", expired ? "TikTok login expired or was revoked — reconnect." : msg);
    } catch {
      /* bookkeeping only */
    }
    return { ok: false, error: expired ? "Nora's TikTok login expired or was revoked — reconnect it on My stats." : msg };
  }
}
