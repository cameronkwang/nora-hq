import "server-only";
import { decodeJwt } from "jose";
import type { Connection } from "../schema";
import { HttpError, errorText, fetchJson, form } from "./http";
import { ops, readTokens } from "./connections";

/** Google OAuth shared by Google Business Profile and Gmail. Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. */

export type GoogleTokens = { accessToken: string; refreshToken: string; accessExpiresAt: number; email?: string | null };

export function googleOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthorizeUrl(scopes: string[], state: string, redirectUri: string, loginHint?: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent"); // always get a refresh token
  u.searchParams.set("include_granted_scopes", "false");
  u.searchParams.set("state", state);
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const r = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: form({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    },
  );
  if (!r.refresh_token) throw new Error("Google didn't return a refresh token. Remove Nora HQ from your Google account's third-party access and connect again.");
  let email: string | null = null;
  let sub: string | null = null;
  if (r.id_token) {
    // Received straight from Google's token endpoint over TLS, so decoding (not verifying) is fine.
    const claims = decodeJwt(r.id_token);
    email = typeof claims.email === "string" ? claims.email : null;
    sub = typeof claims.sub === "string" ? claims.sub : null;
  }
  const tokens: GoogleTokens = { accessToken: r.access_token, refreshToken: r.refresh_token, accessExpiresAt: Date.now() + r.expires_in * 1000, email };
  return { tokens, email, sub, scopes: r.scope ?? null };
}

/** Returns a valid access token, refreshing with the refresh token when needed. Marks the connection on failure. */
export async function googleAccessToken(conn: Connection): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const t = readTokens<GoogleTokens>(conn);
  if (!t?.refreshToken) return { ok: false, error: "Couldn't read the saved Google token (check TOKEN_ENC_KEY), then reconnect in Settings." };
  if (t.accessToken && t.accessExpiresAt - Date.now() > 60_000) return { ok: true, token: t.accessToken };
  const { updateConnectionTokens, setConnectionStatus } = await ops();
  try {
    const r = await fetchJson<{ access_token: string; expires_in: number }>("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: form({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: t.refreshToken, grant_type: "refresh_token" }),
    });
    await updateConnectionTokens(conn.id, { tokens: { ...t, accessToken: r.access_token, accessExpiresAt: Date.now() + r.expires_in * 1000 } });
    return { ok: true, token: r.access_token };
  } catch (e) {
    const invalid = e instanceof HttpError && (e.body as { error?: string } | null)?.error === "invalid_grant";
    const msg = invalid
      ? "Google access expired or was revoked. Reconnect in Settings. (If this keeps happening every 7 days, publish the OAuth consent screen to Production — see docs/setup.md.)"
      : `Couldn't refresh Google access: ${errorText(e)}`;
    await setConnectionStatus(conn.id, invalid ? "expired" : "error", msg);
    return { ok: false, error: msg };
  }
}

/** Turns Google API errors into plain-English messages, especially the "quota is 0 until approved" case. */
export function friendlyGoogleError(e: unknown, api: "Business Profile" | "Gmail"): string {
  if (!(e instanceof HttpError)) return errorText(e);
  const raw = JSON.stringify(e.body ?? "").toLowerCase();
  if (api === "Business Profile" && (e.status === 429 || (e.status === 403 && raw.includes("quota")))) {
    return "Google hasn't approved Business Profile API access for this Cloud project yet (its quota stays at 0 requests/minute until they do). Submit the GBP API access request form — see docs/setup.md, “Google Business Profile access”. If you were approved, wait a minute and try again.";
  }
  if (e.status === 429) return `Google is rate-limiting ${api} requests. Try again in a minute.`;
  if (e.status === 403 && (raw.includes("service_disabled") || raw.includes("has not been used") || raw.includes("is disabled"))) {
    return api === "Gmail"
      ? "The Gmail API isn't enabled in the Google Cloud project. Enable it, wait a few minutes, then retry."
      : "A Business Profile API isn't enabled in the Google Cloud project. Enable the My Business Account Management, Business Information and Google My Business APIs (docs/setup.md).";
  }
  if (e.status === 401) return `Google rejected the saved access for ${api}. Reconnect in Settings.`;
  if (e.status === 403) return `Google says this account doesn't have permission (${e.message}). Make sure the connected Google account is an owner or manager of the Business Profile.`;
  if (e.status === 404) return `Google couldn't find that ${api === "Gmail" ? "message or thread" : "location or review"}.`;
  return e.message;
}
