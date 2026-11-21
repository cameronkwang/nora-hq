import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The shared sign-in password. It lives only in the hosting settings (the APP_PASSWORD variable in Vercel), never in
 * the code: this repository must hold nothing that can be used to sign in, not even a hash of the password.
 * Local dev falls back to "dev". Production has no fallback: while the variable is unset, nobody can sign in.
 * Pure (no server-only imports), so scripts/test-sign-in.ts can load it.
 */
export function signInPassword(env: Record<string, string | undefined> = process.env): string {
  const set = env.APP_PASSWORD?.trim();
  if (set) return set;
  return env.NODE_ENV === "production" ? "" : "dev";
}

/** Compares in constant time whatever the two lengths are. An empty expected password matches nothing. */
export function passwordMatches(input: string, expected: string): boolean {
  if (!expected) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(input), digest(expected));
}
