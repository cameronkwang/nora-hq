import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";

/**
 * OAuth plumbing shared by Instagram, Google Business Profile and Gmail.
 * State = short-lived JWT signed with AUTH_SECRET (provider, optional business, nonce, user) + an httpOnly
 * cookie holding the nonce, so a callback only completes in the browser that started it.
 */

export const OAUTH_PROVIDERS = ["instagram", "google", "gmail"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const STATE_COOKIE = "nhq_oauth_state";
export const STATE_MAX_AGE = 600; // seconds

export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  instagram: "Instagram",
  google: "Google Business Profile",
  gmail: "Gmail",
};

export function isOAuthProvider(p: string): p is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(p);
}

/** Public base URL, no trailing slash. Falls back to the request origin in local dev. */
export function appUrl(fallbackOrigin?: string): string | null {
  const raw = process.env.APP_URL?.trim() || (process.env.NODE_ENV !== "production" ? fallbackOrigin : undefined);
  return raw ? raw.replace(/\/+$/, "") : null;
}

export function redirectUri(provider: OAuthProvider, fallbackOrigin?: string): string | null {
  const base = appUrl(fallbackOrigin);
  return base ? `${base}/api/oauth/${provider}/callback` : null;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "dev-only-insecure-secret-change-me" : "");
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(`oauth-state:${s}`);
}

export type OAuthState = { provider: OAuthProvider; clientId: string | null; nonce: string; user: string };

export async function createState(input: Omit<OAuthState, "nonce">): Promise<{ state: string; nonce: string }> {
  const nonce = randomBytes(16).toString("base64url");
  const state = await new SignJWT({ p: input.provider, c: input.clientId, n: nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.user)
    .setIssuedAt()
    .setExpirationTime(`${STATE_MAX_AGE}s`)
    .sign(secret());
  return { state, nonce };
}

export async function verifyState(state: string | null, cookieNonce: string | undefined): Promise<OAuthState | null> {
  if (!state || !cookieNonce) return null;
  try {
    const { payload } = await jwtVerify(state, secret());
    const provider = String(payload.p ?? "");
    if (!isOAuthProvider(provider) || payload.n !== cookieNonce || !payload.sub) return null;
    return { provider, clientId: typeof payload.c === "string" && payload.c ? payload.c : null, nonce: cookieNonce, user: payload.sub };
  } catch {
    return null;
  }
}
