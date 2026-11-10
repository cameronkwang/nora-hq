// Smoke test for Nora HQ. Usage:
//   BASE_URL=http://localhost:3200 NODE_PATH=$(npm root -g) node scripts/smoke.mjs [crawl|flows|all]
// Optional: SHOTS_DIR=/path to save screenshots, MCP_TOKEN=... to exercise /api/mcp in the flows.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL ?? "http://localhost:3200").replace(/\/$/, "");
const MODE = process.argv[2] ?? "all";
const EMAIL = process.env.SMOKE_EMAIL ?? "nora@local";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "dev";
const CLIENT_IDS = ["yummy-red-bowl-richmond", "yummy-red-bowl-sc", "crab-o-clock", "poke-bros", "maxs-virginia-beach", "snf-kingdom"];
const ROUTES = ["/", "/asks", "/asks/new", "/tasks", "/review", "/calendar", "/calendar/new", "/creators", "/creators/new", "/reviews", "/activity", "/settings", "/clients",
  ...CLIENT_IDS.flatMap((id) => [`/clients/${id}`, `/clients/${id}/settings`])];
const VIEWPORTS = [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 390, height: 844 }];

const failures = [];
const fail = (msg) => { failures.push(msg); console.log("  FAIL " + msg); };
const ok = (msg) => console.log("  ok   " + msg);

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click("button:has-text('Sign in')")]);
  await page.close();
}

function watch(page, label) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, label };
}

async function checkPage(page, path, label, errs) {
  const before = errs.length;
  const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 });
  const status = res?.status();
  if (status !== 200) fail(`${label} ${path}: HTTP ${status}`);
  const overlay = await page.locator("nextjs-portal").count();
  if (overlay) {
    const txt = await page.evaluate(() => document.querySelector("nextjs-portal")?.shadowRoot?.textContent?.slice(0, 300) ?? "");
    if (/error/i.test(txt)) fail(`${label} ${path}: Next error overlay: ${txt}`);
  }
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (sw > iw + 1) {
    const culprit = await page.evaluate(() => {
      const w = window.innerWidth; const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > w + 1 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
        if (out.length > 4) break;
      }
      return out.join(" | ");
    });
    fail(`${label} ${path}: horizontal overflow ${sw} > ${iw} (${culprit})`);
  }
  await page.waitForTimeout(150);
  for (const e of errs.slice(before)) fail(`${label} ${path}: ${e}`);
  if (status === 200 && errs.length === before && sw <= iw + 1) ok(`${label} ${path}`);
}

async function crawl(browser) {
  for (const vp of VIEWPORTS) {
    console.log(`\n== crawl ${vp.name} ${vp.width}px`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    await login(context);
    const page = await context.newPage();
    const { errors } = watch(page);
    for (const path of ROUTES) await checkPage(page, path, vp.name, errors);
    // first creator / draft / task / ask / post detail pages, if any exist
    for (const [list, sel] of [["/creators", "a[href^='/creators/']:not([href='/creators/new']):not([href^='/creators/export'])"], ["/tasks?status=all", "a[href^='/tasks/']"], ["/asks", "a[href^='/asks/']:not([href='/asks/new'])"], ["/calendar", "a[href^='/calendar/']:not([href^='/calendar/new'])"]]) {
      await page.goto(BASE + list, { waitUntil: "networkidle" });
      const href = await page.locator(sel).first().getAttribute("href").catch(() => null);
      if (href) await checkPage(page, href, vp.name, errors);
    }
    await context.close();
  }
}

async function shots(browser, dir) {
  const fs = await import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    await login(context);
    const page = await context.newPage();
    for (const [name, path] of [["home", "/"], ["business", "/clients/crab-o-clock"], ["review", "/review"], ["creators", "/creators"]]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${dir}/${name}-${vp.width}.png`, fullPage: true });
    }
    await context.close();
  }
  ok(`screenshots saved to ${dir}`);
}

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

async function mcp(method, params, token = process.env.MCP_TOKEN) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
async function tool(name, args) {
  const r = await mcp("tools/call", { name, arguments: args });
  const res = r.body?.result;
  if (r.status !== 200 || !res || res.isError) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`);
  const t = res.content?.[0]?.text ?? "";
  try { return JSON.parse(t); } catch { return t; }
}

async function step(name, fn) {
  try { await fn(); ok(name); } catch (e) { fail(`${name}: ${e.message.split("\n")[0]}`); }
}

async function flows(browser) {
  console.log("\n== flows");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await login(context);
  const page = await context.newPage();
  const { errors } = watch(page);
  page.setDefaultTimeout(30000);
  const stamp = Date.now().toString(36);
  const month = ym(new Date());
  const prev = ym(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));

  // tiny 1x1 PNG
  const png = `${os.tmpdir()}/nhq-smoke-${stamp}.png`;
  fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

  await step("create ask with photo", async () => {
    await page.goto(`${BASE}/asks/new`, { waitUntil: "networkidle" });
    const askText = `Smoke ask ${stamp}: post the new crab boil special`;
    await page.locator("textarea").first().fill(askText);
    await page.locator("select[name='clientId']").selectOption("crab-o-clock").catch(() => {});
    await page.locator("input[type='file']").first().setInputFiles(png);
    await page.waitForTimeout(500);
    await page.locator("button[type='submit']").last().click();
    await page.waitForURL(/\/asks\?created=1/, { timeout: 60000 });
    await page.waitForLoadState("networkidle");
    const card = page.locator(`text=${askText}`).first();
    await card.waitFor();
    const imgs = await page.locator("img[src*='/uploads/']").count();
    if (!imgs) throw new Error("ask created but no uploaded image thumbnail shown");
  });

  const taskTitle = `Smoke task ${stamp}`;
  await step("create task on business page and mark it done", async () => {
    await page.goto(`${BASE}/clients/crab-o-clock`, { waitUntil: "networkidle" });
    const form = page.locator("form", { has: page.locator("input[name='title']") }).first();
    await form.locator("input[name='title']").fill(taskTitle);
    await form.locator("button[type='submit']").click();
    const row = page.locator(`text=${taskTitle}`).first();
    await row.waitFor({ timeout: 30000 });
    // the toggle is a button/checkbox inside the row's container
    await page.locator(`button[aria-label="Mark “${taskTitle}” done"]`).first().click();
    // done tasks leave the Outstanding list
    await page.locator(`button[aria-label="Mark “${taskTitle}” done"]`).waitFor({ state: "detached", timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/tasks?status=done`, { waitUntil: "networkidle" });
    await page.locator(`text=${taskTitle}`).first().waitFor({ timeout: 15000 });
  });

  await step("generate month checklist", async () => {
    // use the first business that still has no checklist this month (reruns use up businesses)
    let btn = null, cid = null;
    for (const id of CLIENT_IDS) {
      await page.goto(`${BASE}/clients/${id}`, { waitUntil: "networkidle" });
      const b = page.locator("button:has-text(\"Create this month's checklist\")");
      if (await b.count()) { btn = b; cid = id; break; }
    }
    if (!btn) { console.log("       (every business already has this month's checklist; skipping)"); return; }
    await btn.first().click();
    await page.waitForFunction(() => !document.body.innerText.includes("Create this month's checklist"), null, { timeout: 30000 });
    await page.goto(`${BASE}/tasks?client=${cid}`, { waitUntil: "networkidle" });
    const n = await page.locator("text=Instagram stories").count();
    if (!n) throw new Error("checklist tasks not found on /tasks");
  });

  for (const [m, ig, tt] of [[prev, "12000", "8000"], [month, "15400", "9100"]]) {
    await step(`enter views for ${m}`, async () => {
      await page.goto(`${BASE}/clients/crab-o-clock?month=${m}`, { waitUntil: "networkidle" });
      const details = page.locator("details", { has: page.locator("input[name='instagram_views'], input[name='ig_views'], input[name*='views']") }).first();
      if (await details.count()) { const open = await details.getAttribute("open"); if (open === null) await details.locator("summary").click(); }
      const inputs = page.locator("input[name*='views']");
      const names = await inputs.evaluateAll((els) => els.map((e) => e.getAttribute("name")));
      const igName = names.find((n) => /^insta|^ig/i.test(n)); const ttName = names.find((n) => /^tiktok|^tt/i.test(n));
      if (!igName || !ttName) throw new Error(`views inputs not found: ${names.join(",")}`);
      await page.fill(`input[name='${igName}']`, ig);
      await page.fill(`input[name='${ttName}']`, tt);
      await page.locator(`input[name='${igName}']`).locator("xpath=ancestor::form").locator("button[type='submit']").click();
      await page.waitForTimeout(2000);
      await page.reload({ waitUntil: "networkidle" });
      const saved = (await page.inputValue(`input[name='${igName}']`)).replace(/[,\s]/g, "");
      if (saved !== ig) throw new Error(`saved Instagram views not shown (input reads ${saved})`);
    });
  }
  await step("views chart renders with data", async () => {
    await page.goto(`${BASE}/clients/crab-o-clock`, { waitUntil: "networkidle" });
    const paths = await page.locator("svg path, svg polyline").count();
    if (paths < 2) throw new Error(`chart has ${paths} paths`);
  });

  const creatorName = `Smoke Creator ${stamp}`;
  const handle = `smoke_${stamp}`;
  let creatorUrl = "";
  await step("add creator with outreach for Crab O Clock", async () => {
    await page.goto(`${BASE}/creators/new?client=crab-o-clock`, { waitUntil: "networkidle" });
    await page.fill("input[name='name']", creatorName);
    await page.fill("input[name='instagramHandle']", handle);
    const f = page.locator("input[name='instagramFollowers']");
    if (await f.count()) await f.first().fill("12.5k");
    await page.locator("button[type='submit']").last().click();
    await page.waitForURL(/\/creators\/(?!new)[^/?]+/, { timeout: 30000 });
    creatorUrl = page.url();
    await page.waitForLoadState("networkidle");
    if (!(await page.locator("text=Crab O Clock").count())) throw new Error("outreach card for Crab O Clock missing");
  });

  await step("create calendar post", async () => {
    await page.goto(`${BASE}/calendar/new?client=crab-o-clock&platform=instagram`, { waitUntil: "networkidle" });
    const d = new Date(); d.setDate(d.getDate() + 3);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dateInput = page.locator("input[type='date']").first();
    if (await dateInput.count()) await dateInput.fill(ds);
    const timeInput = page.locator("input[type='time']").first();
    if (await timeInput.count()) await timeInput.fill("12:30");
    await page.locator("textarea[name='caption']").fill(`Smoke post ${stamp} — crab boil Fridays`);
    await page.locator("button[type='submit']").last().click();
    await page.waitForURL(/\/calendar(\/|\?)/, { timeout: 30000 });
    await page.goto(`${BASE}/calendar?client=crab-o-clock&month=${ym(d)}`, { waitUntil: "networkidle" });
    if (!(await page.locator(`text=Smoke post ${stamp}`).count()) && !(await page.locator(`text=crab boil Fridays`).count())) throw new Error("post not on calendar");
  });

  if (process.env.MCP_TOKEN) {
    let dmDraftId = "", igDraftId = "";
    await step("mcp: 401 without token", async () => {
      const r = await mcp("tools/list", {}, "");
      if (r.status !== 401) throw new Error(`got ${r.status}`);
    });
    await step("mcp: initialize + tools/list + get_briefing", async () => {
      const i = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
      if (i.status !== 200 || !i.body?.result?.serverInfo) throw new Error(`initialize ${i.status} ${JSON.stringify(i.body).slice(0, 200)}`);
      const l = await mcp("tools/list", {});
      const n = l.body?.result?.tools?.length ?? 0;
      if (n < 20) throw new Error(`only ${n} tools`);
      const b = await tool("get_briefing", {});
      if (!JSON.stringify(b).includes("crab-o-clock")) throw new Error("briefing lacks clients");
    });
    await step("mcp: create outreach_dm + instagram_post drafts", async () => {
      const found = await tool("search_creators", { q: handle });
      const s = JSON.stringify(found);
      const outreachId = (s.match(/"(?:outreachId|id)":"(out_[^"]+)"/) ?? [])[1];
      if (!outreachId) throw new Error(`no outreach id in search_creators result: ${s.slice(0, 400)}`);
      const dm = await tool("create_draft", { client_id: "crab-o-clock", kind: "outreach_dm", title: `DM ${creatorName}`, body: `Hey! We'd love to host you at Crab O Clock for a gifted meal. If you post, please tag it #gifted. Interested?`, meta: { outreachId, channel: "instagram_dm" } });
      dmDraftId = (JSON.stringify(dm).match(/"(drf_[^"]+)"/) ?? [])[1] ?? "";
      const ig = await tool("create_draft", { client_id: "crab-o-clock", kind: "instagram_post", title: `IG post ${stamp}`, body: `Friday crab boil is back 🦀 #crabboil #seafood` });
      igDraftId = (JSON.stringify(ig).match(/"(drf_[^"]+)"/) ?? [])[1] ?? "";
      if (!dmDraftId || !igDraftId) throw new Error(`draft ids missing: ${JSON.stringify(dm).slice(0, 200)} / ${JSON.stringify(ig).slice(0, 200)}`);
    });
    await step("review: approve IG draft", async () => {
      await page.goto(`${BASE}/review?draft=${igDraftId}`, { waitUntil: "networkidle" });
      await page.locator("button:has-text('Approve')").first().click();
      await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
      await page.goto(`${BASE}/review?draft=${igDraftId}`, { waitUntil: "networkidle" });
      const t = await page.locator("main").innerText();
      if (/Needs review/.test(t) && (await page.locator("button:has-text('Approve')").count())) throw new Error("IG draft still awaiting approval");
    });
    await step("review: approve + mark sent DM draft", async () => {
      await page.goto(`${BASE}/review?draft=${dmDraftId}`, { waitUntil: "networkidle" });
      await page.locator("button:has-text('Approve')").first().click();
      await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
      await page.goto(`${BASE}/review?draft=${dmDraftId}`, { waitUntil: "networkidle" });
      await page.locator("button:has-text('Mark sent')").first().click();
      await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
    });
    await step("outreach stage became contacted", async () => {
      await page.goto(creatorUrl, { waitUntil: "networkidle" });
      const stage = await page.locator("select[name='stage']").first().inputValue();
      if (stage !== "contacted") throw new Error(`creator page stage is ${stage}, not contacted`);
      await page.goto(`${BASE}/clients/crab-o-clock?creators=month`, { waitUntil: "networkidle" });
      const c = await page.locator("#creators").innerText();
      if (!c.includes(creatorName)) throw new Error("business page 'Contacted this month' filter lacks the creator");
      if (!/[1-9]\d* contacted in/.test(c)) throw new Error("business page shows 0 contacted this month");
    });
  }

  for (const e of errors) fail(`flows: ${e}`);
  await context.close();
}

const browser = await chromium.launch();
try {
  if (MODE === "crawl" || MODE === "all") await crawl(browser);
  if (MODE === "flows" || MODE === "all") await flows(browser);
  if (process.env.SHOTS_DIR) await shots(browser, process.env.SHOTS_DIR);
} finally {
  await browser.close();
}
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : "ALL PASSED"}`);
process.exit(failures.length ? 1 : 0);
