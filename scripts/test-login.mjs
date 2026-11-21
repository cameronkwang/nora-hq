// Signing a test browser in to a LOCAL Nora HQ server (scripts/smoke.mjs and any other local test script use this).
//
// `next dev` takes the local password ("dev") on the sign-in form. A production build (`next build` + `next start`)
// does not: there the form checks the real password's built-in hash (src/lib/team.ts), which no test knows and no
// test should. So against a production build the test signs itself in: it makes the session cookie with the test
// server's own AUTH_SECRET. Start that server with `npm run start:test`, which sets the throwaway values below
// (AUTH_SECRET, APP_USERS for cameron@local and nora@local, the dev TOKEN_ENC_KEY, and the test MCP / cron / Stripe
// webhook secrets). The app has no special case for any of this: a server with any other AUTH_SECRET (the real one)
// ignores the cookie, and the sign-in page and its lockout are untouched.
// Because that AUTH_SECRET is written down here, `start:test` also blanks DATABASE_URL (so the server can only ever
// open the embedded sample database in ./.data, never the real one, whatever an .env file says) and listens on
// 127.0.0.1 only. Never give a server that holds real data this AUTH_SECRET.
//
//   import { signIn } from "./test-login.mjs";    await signIn(context, "http://localhost:3200", "nora@local");
//   node scripts/test-login.mjs nora@local        prints "nhq_session=<value>" for curl -H "cookie: ..."
import { createHmac } from "node:crypto";

/** The AUTH_SECRET `npm run start:test` gives the local production server. Not a secret: it only ever signs local test sessions. */
export const TEST_AUTH_SECRET = process.env.SMOKE_AUTH_SECRET ?? "local-test-server-only-not-a-secret";
export const SESSION_COOKIE = "nhq_session";
const NAMES = { "cameron@local": "Cameron", "nora@local": "Nora" };
const b64u = (s) => Buffer.from(s).toString("base64url");

/** The same token src/lib/session.ts signs: HS256, sub = email, name, 30 days. */
export function sessionToken(email, secret = TEST_AUTH_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "HS256" }));
  const body = b64u(JSON.stringify({ name: NAMES[email] ?? email.split("@")[0], sub: email, iat: now, exp: now + 30 * 86400 }));
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

const modes = new Map(); // base -> "cookie" | "form"
/** "cookie" when the server at `base` accepts a session signed with the test secret (the production test server), else "form" (next dev). */
export async function signInMode(base) {
  if (!modes.has(base)) {
    const res = await fetch(`${base}/settings`, { redirect: "manual", headers: { cookie: `${SESSION_COOKIE}=${sessionToken("cameron@local")}` } }).catch(() => null);
    modes.set(base, res?.status === 200 ? "cookie" : "form");
  }
  return modes.get(base);
}

/** Signs a Playwright browser context in as `email` (cameron@local or nora@local). */
export async function signIn(context, base, email = "cameron@local", password = "dev") {
  if ((await signInMode(base)) === "cookie") {
    await context.addCookies([{ name: SESSION_COOKIE, value: sessionToken(email), url: base, httpOnly: true, sameSite: "Lax" }]);
    return "cookie";
  }
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }).catch(() => {
      throw new Error(`could not sign in as ${email} at ${base}. On a production build (next start) the form does not take the local password: start the server with "npm run start:test" (see scripts/test-login.mjs).`);
    }),
    page.click("button:has-text('Sign in')"),
  ]);
  await page.close();
  return "form";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${SESSION_COOKIE}=${sessionToken(process.argv[2] ?? "cameron@local")}`);
}
