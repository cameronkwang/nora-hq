import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { passwordMatches, signInPassword } from "./password-check";
import { TEAM } from "./team";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";

/**
 * APP_USERS="Cameron:cameron@example.com,Nora:nora@example.com" — the only people who can sign in.
 * APP_PASSWORD — shared sign-in password (keep it long). In local dev both have defaults. In production the password
 * comes only from this variable (lib/password-check.ts): nothing in the code can be used to sign in.
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

export function checkPassword(input: string): boolean {
  return passwordMatches(input, signInPassword());
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

/**
 * Drafts (Claude's DMs, emails, pitches, captions waiting for approval) are Cameron's to review. Nora uses HQ to
 * track her own work and send asks, so she never sees the review queue or draft lists: less to wade through.
 */
export function seesDrafts(user: SessionUser): boolean {
  return assigneeFor(user) !== "nora";
}
