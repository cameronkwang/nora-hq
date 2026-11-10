import { SignJWT, jwtVerify } from "jose";

/** Edge-safe session helpers (used by middleware and server code). */
export const SESSION_COOKIE = "nhq_session";
const MAX_AGE_DAYS = 30;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "dev-only-insecure-secret-change-me" : "");
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type SessionUser = { email: string; name: string };

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.email)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_DAYS}d`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return { email: payload.sub, name: String(payload.name ?? payload.sub) };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = MAX_AGE_DAYS * 86400;
