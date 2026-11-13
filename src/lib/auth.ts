import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { PASSWORD_HASH, TEAM } from "./team";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";

/**
 * APP_USERS="Cameron:cameron@example.com,Nora:nora@example.com" — the only people who can sign in.
 * APP_PASSWORD — shared sign-in password (keep it long). In local dev both have defaults.
 */
const isProd = process.env.NODE_ENV === "production";

/** Tolerates stray quotes/whitespace pasted into the Vercel value. */
const clean = (s: string) => s.trim().replace(/^["']+|["']+$/g, "").trim();

export function allowedUsers(): SessionUser[] {
  const raw = process.env.APP_USERS ?? (!isProd ? "Cameron:cameron@local,Nora:nora@local" : "");
  const fromEnv = clean(raw)
    .split(",")
    .map(clean)
    .filter(Boolean)
    .map((p) => {
      const [name, email] = p.includes(":") ? p.split(":") : [p.split("@")[0], p];
      return { name: clean(name), email: clean(email).toLowerCase() };
    });
  // In production the built-in team is always allowed; APP_USERS can add more people.
  const users = isProd ? [...TEAM.map((t) => ({ name: t.name, email: t.email.toLowerCase() })), ...fromEnv] : fromEnv;
  const seen = new Set<string>();
  return users.filter((u) => u.email && !seen.has(u.email) && (seen.add(u.email), true));
}

function checkHash(input: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split(":");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(input, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function checkPassword(input: string): boolean {
  // Production: the built-in hashed password (lib/team.ts) is the sign-in password.
  if (isProd && PASSWORD_HASH) return checkHash(input, PASSWORD_HASH);
  const expected = process.env.APP_PASSWORD ?? (!isProd ? "dev" : "");
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const user = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!user) return null;
  // Revoke sessions for people removed from APP_USERS.
  return allowedUsers().some((u) => u.email === user.email) ? user : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Maps a signed-in user to the task assignee value ("nora" | "cameron" | ...). */
export function assigneeFor(user: SessionUser): string {
  return user.name.toLowerCase();
}
