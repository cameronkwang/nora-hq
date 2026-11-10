import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";

/**
 * APP_USERS="Cameron:cameron@example.com,Nora:nora@example.com" — the only people who can sign in.
 * APP_PASSWORD — shared sign-in password (keep it long). In local dev both have defaults.
 */
export function allowedUsers(): SessionUser[] {
  const raw = process.env.APP_USERS ?? (process.env.NODE_ENV !== "production" ? "Cameron:cameron@local,Nora:nora@local" : "");
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [name, email] = p.includes(":") ? p.split(":") : [p.split("@")[0], p];
      return { name: name.trim(), email: email.trim().toLowerCase() };
    });
}

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD ?? (process.env.NODE_ENV !== "production" ? "dev" : "");
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
