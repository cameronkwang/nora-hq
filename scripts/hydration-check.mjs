// Counts React hydration errors (#418) on a production build when a page arrives slowly, the way it does on a phone
// with a weak signal. Found in Nov 2026 while moving the smoke test to a production build: on `next start` (never on
// `next dev`) some page loads report "Minified React error #418"; React then throws away the server's HTML and draws
// the page again in the browser. The page works afterwards. It is on every page, signed in or not, on main as well
// as on feature branches, so it is not tied to one screen.
// What sets it off: React starts on the page before all of the page's data has arrived (the data of a long page
// comes in several <script> pieces; a list's later rows are among the last), and its second try, once the rest is
// there, fails. Measured on one browser: none at full speed; at 400 kbit/s 3 to 20% of loads across pages and about
// 1 in 4 on /invoices; 0 in 30 when the app's main script is held back until the whole page has arrived.
// See docs/invoicing.md "Testing".
//
//   npx next build && npm run start:test
//   NODE_PATH=$(npm root -g) node scripts/hydration-check.mjs [/tasks,/invoices,...]     KBPS=400 N=30 by default
import { createRequire } from "node:module";
import { signIn } from "./test-login.mjs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = (process.env.BASE_URL ?? "http://localhost:3200").replace(/\/$/, "");
const ROUTES = (process.argv[2] ?? "/tasks,/,/asks,/invoices").split(",");
const N = Number(process.env.N ?? 30), KBPS = Number(process.env.KBPS ?? 400);

const browser = await chromium.launch();
const d = devices["iPhone 15 Pro"];
const context = await browser.newContext({ viewport: d.viewport, screen: d.screen, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: d.userAgent, colorScheme: "dark" });
await signIn(context, BASE, process.env.SMOKE_EMAIL ?? "nora@local");
const page = await context.newPage();
for (const r of ROUTES) await page.goto(BASE + r, { waitUntil: "networkidle" }); // scripts cached at full speed first
if (KBPS > 0) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 5, downloadThroughput: (KBPS * 1024) / 8, uploadThroughput: (KBPS * 1024) / 8 });
}
const hits = new Map();
let current = "", loads = 0;
page.on("pageerror", (e) => { if (/#418|Hydration failed/.test(e.message)) hits.set(current, (hits.get(current) ?? 0) + 1); });
for (let i = 0; i < N; i++) for (const r of ROUTES) {
  current = r;
  await page.goto(BASE + r, { waitUntil: "load" });
  await page.waitForTimeout(150);
  loads++;
}
await browser.close();
const total = [...hits.values()].reduce((a, b) => a + b, 0);
console.log(`${KBPS ? `${KBPS} kbit/s` : "full speed"}, one browser: ${total} hydration error(s) in ${loads} loads`);
for (const [r, n] of hits) console.log(`  ${r}: ${n} of ${N}`);
process.exit(total ? 1 : 0);
