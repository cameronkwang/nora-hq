import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { newId } from "./ids";

/**
 * Brute-force protection for the shared-password sign-in.
 * - 5 failed attempts from one IP within 15 minutes → that IP is locked out until the window clears.
 * - 20 failed attempts against one email within 15 minutes (from any IPs) → that email is locked too,
 *   which slows down guessing spread across many IPs.
 * A successful sign-in clears the failures for that IP.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_IP = 5;
const MAX_PER_EMAIL = 20;

async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  const salt = process.env.AUTH_SECRET ?? "dev-salt";
  return createHash("sha256").update(`${salt}:login:${ip}`).digest("hex");
}

export type LockState = { locked: false } | { locked: true; minutes: number };

async function lockFor(where: ReturnType<typeof and>, max: number, since: Date): Promise<number | null> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | string | null>`min(${schema.loginAttempts.createdAt})` })
    .from(schema.loginAttempts)
    .where(and(where, gte(schema.loginAttempts.createdAt, since)));
  if (!row || row.n < max || !row.oldest) return null;
  const freesAt = new Date(row.oldest).getTime() + WINDOW_MS;
  return Math.max(1, Math.ceil((freesAt - Date.now()) / 60_000));
}

export async function checkLogin(email: string): Promise<LockState & { ipHash: string }> {
  const ipHash = await clientIpHash();
  const since = new Date(Date.now() - WINDOW_MS);
  const byIp = await lockFor(eq(schema.loginAttempts.ipHash, ipHash), MAX_PER_IP, since);
  const byEmail = email ? await lockFor(eq(schema.loginAttempts.email, email), MAX_PER_EMAIL, since) : null;
  const minutes = Math.max(byIp ?? 0, byEmail ?? 0);
  return minutes > 0 ? { locked: true, minutes, ipHash } : { locked: false, ipHash };
}

export async function recordFailedLogin(ipHash: string, email: string) {
  const db = await getDb();
  await db.insert(schema.loginAttempts).values({ id: newId("la_"), ipHash, email: email || null });
  // Keep the table small.
  await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.createdAt, new Date(Date.now() - 7 * 86400_000)));
}

export async function clearFailedLogins(ipHash: string) {
  const db = await getDb();
  await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.ipHash, ipHash));
}
