// Smoke test for Nora HQ. Usage:
//   BASE_URL=http://localhost:3200 NODE_PATH=$(npm root -g) node scripts/smoke.mjs [crawl|flows|all|responsive]
// Optional: SHOTS_DIR=/path to save screenshots, MCP_TOKEN=... to exercise /api/mcp in the flows.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL ?? "http://localhost:3200").replace(/\/$/, "");
const MODE = process.argv[2] ?? "all";
const EMAIL = process.env.SMOKE_EMAIL ?? "nora@local";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "dev";
const CLIENT_IDS = ["yummy-red-bowl-richmond", "yummy-red-bowl-sc", "crab-o-clock", "poke-bros", "maxs-virginia-beach", "snf-kingdom"];
const ROUTES = ["/", "/asks", "/asks/new", "/tasks", "/tasks?view=list", "/tasks?view=board", "/tasks?view=table", "/tasks/import", "/review", "/calendar", "/calendar/new",
  "/creators", "/creators?view=table", "/creators?view=pipeline", "/creators/new", "/creators/import", "/leads", "/leads?view=board", "/leads/new", "/leads/import", "/numbers", "/reviews", "/activity", "/settings", "/settings/capture", "/stats", "/tasks?scope=adhoc", "/tasks?scope=plan", "/tasks?scope=all", "/clients", "/clients/new", "/clients/noraeatsgood", "/clients/noraeatsgood/settings", "/collabs",
  ...CLIENT_IDS.flatMap((id) => [`/clients/${id}`, `/clients/${id}/settings`])];
const PUBLIC_ROUTES = ["/collab"];
const VIEWPORTS = [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 390, height: 844 }];

const failures = [];
const fail = (msg) => { failures.push(msg); console.log("  FAIL " + msg); };
const ok = (msg) => console.log("  ok   " + msg);

async function login(context, email = EMAIL) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
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
    for (const [list, sel] of [["/creators", "a[href^='/creators/']:not([href='/creators/new']):not([href^='/creators/export']):not([href^='/creators/import'])"], ["/tasks?status=all", "a[href^='/tasks/']:not([href^='/tasks/import']):not([href^='/tasks/export'])"], ["/asks", "a[href^='/asks/']:not([href='/asks/new'])"], ["/calendar", "a[href^='/calendar/']:not([href^='/calendar/new'])"], ["/leads", "a[href^='/leads/']:not([href='/leads/new']):not([href^='/leads/import']):not([href^='/leads/export'])"], ["/collabs", "a[href^='/collabs/']"]]) {
      await page.goto(BASE + list, { waitUntil: "networkidle" });
      const href = await page.locator(sel).first().getAttribute("href").catch(() => null);
      if (href) await checkPage(page, href, vp.name, errors);
    }
    await context.close();
    // public pages, logged out
    const pub = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const pp = await pub.newPage();
    const pw = watch(pp);
    for (const path of PUBLIC_ROUTES) await checkPage(pp, path, `${vp.name} logged-out`, pw.errors);
    await pub.close();
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

/** Calls a tool and returns { isError, text } without throwing on a tool-level refusal. */
async function toolRaw(name, args) {
  const r = await mcp("tools/call", { name, arguments: args });
  if (r.status !== 200) throw new Error(`${name}: HTTP ${r.status}`);
  if (r.body?.error) return { isError: true, text: JSON.stringify(r.body.error) };
  const res = r.body?.result;
  return { isError: !!res?.isError, text: res?.content?.[0]?.text ?? "" };
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
    await page.waitForURL(/\/\?sent=auto/, { timeout: 60000 });
    await page.waitForLoadState("networkidle");
    await page.goto(`${BASE}/asks`, { waitUntil: "networkidle" });
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
    await page.goto(`${BASE}/tasks?client=${cid}&scope=plan`, { waitUntil: "networkidle" });
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

  /* ── new modules: tasks views, creators import, numbers sheet, ask thread ── */
  if (process.env.MCP_TOKEN) {
    const [tA, tB, tC] = [`Smoke drag ${stamp}`, `Smoke bulk ${stamp}`, `Smoke edit ${stamp}`];
    const ids = {};
    await step("mcp: create 3 tasks for the board/table flows", async () => {
      for (const t of [tA, tB, tC]) {
        const r = await tool("create_task", { client_id: "poke-bros", title: t });
        ids[t] = (JSON.stringify(r).match(/"(tsk_[^"]+)"/) ?? [])[1];
        if (!ids[t]) throw new Error(`no task id: ${JSON.stringify(r).slice(0, 200)}`);
      }
    });
    const taskStatus = async (title) => {
      const r = await tool("list_tasks", { client_id: "poke-bros", status: "done" });
      return JSON.stringify(r).includes(title) ? "done" : "not done";
    };
    await step("tasks board: drag a card to Done", async () => {
      await page.goto(`${BASE}/tasks?view=board&client=poke-bros`, { waitUntil: "networkidle" });
      const card = page.locator("article[draggable='true']:visible", { hasText: tA }).first();
      const done = page.locator("section[aria-label='Done']:visible").first();
      await card.scrollIntoViewIfNeeded();
      await card.dragTo(done, { targetPosition: { x: 40, y: 20 } }); // the column header, so long columns don't scroll mid-drag
      await page.locator("section[aria-label='Done']:visible", { hasText: tA }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1500);
      await page.reload({ waitUntil: "networkidle" });
      if (!(await page.locator("section[aria-label='Done']:visible", { hasText: tA }).count())) throw new Error("card not in Done after reload");
    });
    await step("tasks table: bulk mark done", async () => {
      await page.goto(`${BASE}/tasks?view=table&client=poke-bros`, { waitUntil: "networkidle" });
      await page.locator(`input[type='checkbox'][aria-label="Select “${tB}”"]:visible`).first().check({ force: true }); // the label’s tap-target ::after sits over the box by design
      await page.locator("[aria-label='Bulk actions'] button:has-text('Mark done'):visible").first().click();
      await page.waitForTimeout(2000);
      const st = await taskStatus(tB);
      if (st !== "done") throw new Error(`status is ${st}`);
    });
    await step("tasks table: inline-edit a title", async () => {
      await page.goto(`${BASE}/tasks?view=table&client=poke-bros`, { waitUntil: "networkidle" });
      const input = page.locator(`input[aria-label='Title'][value="${tC}"]:visible`).first();
      await input.fill(`${tC} edited`);
      await input.press("Enter");
      await page.waitForTimeout(2000);
      await page.goto(`${BASE}/tasks/${ids[tC]}`, { waitUntil: "networkidle" });
      if (!(await page.locator(`input[value="${tC} edited"], :text("${tC} edited")`).count())) throw new Error("edited title not saved");
    });
  }

  const impA = `imp_a_${stamp}`, impB = `imp_b_${stamp}`;
  await step("creators: import 2 via pasted CSV", async () => {
    await page.goto(`${BASE}/creators/import`, { waitUntil: "networkidle" });
    await page.fill("#imp-text", `Name,Instagram,Followers,City\nImport A ${stamp},@${impA},12.5k,Richmond\nImport B ${stamp},@${impB},"1,200",Norfolk`);
    const btn = page.locator("button:has-text('Import'):visible").filter({ hasNotText: "more" }).last();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Import \d/.test(b.textContent?.trim() ?? "") && !b.disabled), null, { timeout: 30000 });
    await page.locator("button:visible", { hasText: /^Import \d/ }).first().click();
    await page.locator("text=Import finished").waitFor({ timeout: 30000 });
    await page.goto(`${BASE}/creators?view=table&q=${impA}`, { waitUntil: "networkidle" });
    for (const n of [impA, impB]) {
      await page.goto(`${BASE}/creators?view=table&q=${n}`, { waitUntil: "networkidle" });
      if (!(await page.locator(`text=Import ${n === impA ? "A" : "B"} ${stamp}`).count()) && !(await page.locator(`input[value="Import ${n === impA ? "A" : "B"} ${stamp}"]`).count())) throw new Error(`${n} not found after import`);
    }
  });

  await step("numbers: type a value, see it on the business page", async () => {
    await page.goto(`${BASE}/numbers`, { waitUntil: "networkidle" });
    const cell = page.locator("tr:has(th a[href^='/clients/poke-bros']) input[data-cell]:visible").last();
    const label = await cell.getAttribute("aria-label");
    const dc = await cell.getAttribute("data-cell");
    await cell.click();
    const v = 20000 + Math.floor(Math.random() * 9000) * 100; // unique per run so the cell really changes
    await cell.fill(`${v / 1000}k`);
    await cell.press("Tab");
    await page.waitForFunction(() => /Saved/.test(document.body.innerText), null, { timeout: 15000 });
    const href = await page.locator(`tr:has(input[data-cell="${dc}"]) th a`).first().getAttribute("href");
    await page.goto(BASE + href.replace(/#.*/, ""), { waitUntil: "networkidle" });
    const vals = await page.locator("#views input[name*='views']").evaluateAll((els) => els.map((e) => e.value.replace(/[,\s]/g, "")));
    if (!vals.includes(String(v))) throw new Error(`${v} not on business page (${label}); views inputs read ${vals.join("/")}`);
  });

  if (process.env.MCP_TOKEN) {
    let askId = "";
    await step("ask thread: Claude asks via reply_to_ask, Nora replies in the UI", async () => {
      const list = await tool("list_asks", {});
      askId = (JSON.stringify(list).match(/"(ask_[^"]+)"/) ?? [])[1] ?? "";
      if (!askId) throw new Error("no ask to reply on");
      const q = `Which day should the crab boil post go out? (${stamp})`;
      const r = await tool("reply_to_ask", { ask_id: askId, body: q, status: "in_progress" });
      if (r.askStatus !== "in_progress") throw new Error(`askStatus ${r.askStatus}`);
      await page.goto(`${BASE}/asks/${askId}`, { waitUntil: "networkidle" });
      await page.locator(`text=${q}`).first().waitFor();
      const ans = `Friday please (${stamp})`;
      await page.fill("#ask-reply", ans);
      await page.locator("form:has(#ask-reply) button[type='submit']").click();
      await page.locator(`text=${ans}`).first().waitFor({ timeout: 15000 });
      const again = await tool("list_asks", {});
      const s = JSON.stringify(again);
      if (!s.includes(ans)) throw new Error("reply not visible via MCP list_asks");
      const b = JSON.stringify(await tool("get_briefing", {}));
      if (!b.includes(askId) || !b.includes("needsYourReply")) throw new Error("briefing does not hand the ask back");
    });
  }

  /* ── ask routing, leads, onboarding ── */
  if (process.env.MCP_TOKEN) {
    const camAsk = `Smoke for Cameron ${stamp}: reset the TikTok password`;
    await step("ask with the Cameron chip → Cameron's task + For me", async () => {
      await page.goto(`${BASE}/asks/new`, { waitUntil: "networkidle" });
      await page.locator("#ask-body").fill(camAsk);
      await page.locator("label", { hasText: /^Cameron$/ }).first().click();
      await page.locator("button[type='submit']:has-text('Send')").click();
      await page.waitForURL(/\/\?sent=cameron/, { timeout: 60000 });
      const cam = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await login(cam, "cameron@local");
      const cp = await cam.newPage();
      await cp.goto(`${BASE}/asks?tab=me`, { waitUntil: "networkidle" });
      if (!(await cp.locator(`text=${camAsk}`).count())) throw new Error("ask not in Cameron's For me tab");
      await cp.goto(`${BASE}/tasks?assignee=me&view=list`, { waitUntil: "networkidle" });
      if (!(await cp.locator(`text=Smoke for Cameron ${stamp}`).count())) throw new Error("no task for Cameron on /tasks?assignee=me");
      await cam.close();
    });

    const autoAsk = `Smoke triage ${stamp}: please film the new dessert`;
    await step("mcp triage_ask routes an auto ask to Nora → task created", async () => {
      await page.goto(`${BASE}/asks/new`, { waitUntil: "networkidle" });
      await page.locator("#ask-body").fill(autoAsk);
      await page.locator("button[type='submit']:has-text('Send')").click();
      await page.waitForURL(/\/\?sent=auto/, { timeout: 60000 });
      const list = JSON.stringify(await tool("list_asks", {}));
      const i = list.indexOf(autoAsk);
      const id = i < 0 ? "" : ([...list.slice(0, i).matchAll(/"(ask_[^"]+)"/g)].pop() ?? [])[1];
      if (!id) throw new Error("new ask not visible via list_asks");
      const r = await tool("triage_ask", { ask_id: id, kind: "request", for_who: "nora" });
      if (!r.taskCreated) throw new Error(`no taskCreated: ${JSON.stringify(r).slice(0, 300)}`);
      const again = await tool("triage_ask", { ask_id: id, kind: "request", for_who: "nora" });
      if (again.taskCreated) throw new Error("re-triage created a second task");
      await page.goto(`${BASE}/tasks?assignee=me&view=list`, { waitUntil: "networkidle" });
      if (!(await page.locator(`text=Smoke triage ${stamp}`).count())) throw new Error("routed task not on Nora's list");
    });

    await step("Find leads form creates a Claude ask", async () => {
      await page.goto(`${BASE}/leads`, { waitUntil: "networkidle" });
      await page.locator("button:has-text('Find leads')").first().click();
      await page.fill("#fl-area", `Smoketown ${stamp}`);
      await page.locator("button:has-text('Ask Claude to find them')").click();
      await page.locator("text=Sent to Claude").waitFor({ timeout: 30000 });
      const s = JSON.stringify(await tool("list_asks", {}));
      if (!s.includes(`Smoketown ${stamp}`)) throw new Error("research ask not visible to Claude");
    });

    const site = `https://sample-noodle-${stamp}.example.com`;
    let leadId = "";
    await step("mcp add_lead twice with the same website dedupes", async () => {
      const base = { name: `Sample Noodle House ${stamp}`, city: "Richmond, VA", website: site, instagram_handle: `samplenoodle_${stamp}`,
        google_rating: "4.4", google_review_count: "312 reviews", reply_rate: "5%", opportunities: ["google", "social"], score: 72,
        why: "312 Google reviews, owner replied to ~5% of recent ones." };
      const a = await tool("add_lead", base);
      const b = await tool("add_lead", { ...base, name: `Sample Noodle House`, website: `${site}/menu`, instagram_followers: "1.2k" });
      leadId = a.leadId;
      if (!a.created || b.created || b.leadId !== a.leadId) throw new Error(`not deduped: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
      const n = (JSON.stringify(await tool("list_leads", { limit: 200 })).match(new RegExp(`sample-noodle-${stamp}`, "g")) ?? []).length;
      if (n !== 1) throw new Error(`${n} leads with that website`);
    });

    await step("Claude (MCP) can't set lead stage to won / contacted", async () => {
      for (const stage of ["won", "contacted"]) {
        const r = await toolRaw("update_lead", { lead_id: leadId, stage });
        if (!r.isError) throw new Error(`update_lead stage ${stage} was accepted`);
      }
      const l = await tool("get_lead", { lead_id: leadId });
      if (JSON.stringify(l).match(/"stage":"(won|contacted)"/)) throw new Error("stage changed");
    });

    await step("mcp create_draft lead_dm → approve + mark sent → lead contacted", async () => {
      const d = await tool("create_draft", { kind: "lead_dm", title: `Pitch ${stamp}`, meta: { leadId, channel: "instagram_dm" },
        body: "Hi! I'm Nora, a Richmond food creator. Your noodles look amazing and I noticed lots of Google reviews without replies — I help with that. Quick chat? If it's not for you, no worries." });
      const id = d.draftId;
      if (!id) throw new Error(`no draftId: ${JSON.stringify(d).slice(0, 200)}`);
      await page.goto(`${BASE}/review?draft=${id}`, { waitUntil: "networkidle" });
      await page.locator(`#d-${id} button:has-text('Approve')`).first().click();
      await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
      await page.goto(`${BASE}/review?draft=${id}`, { waitUntil: "networkidle" });
      await page.locator(`#d-${id} button:has-text('Mark sent')`).first().click();
      await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
      const l = JSON.stringify(await tool("get_lead", { lead_id: leadId }));
      if (!l.includes('"stage":"contacted"')) throw new Error(`lead not contacted: ${l.slice(0, 300)}`);
    });

    await step("lead → talking in the UI → Start managing → Getting started", async () => {
      await page.goto(`${BASE}/leads/${leadId}`, { waitUntil: "networkidle" });
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST", { timeout: 30000 }),
        page.locator("select[name='stage']").first().selectOption("talking"),
      ]);
      await page.waitForTimeout(1000);
      await page.goto(`${BASE}/leads/${leadId}`, { waitUntil: "networkidle" });
      const link = page.locator("a:has-text('Start managing')").first();
      await link.waitFor({ timeout: 15000 });
      await link.click();
      await page.waitForURL(/\/clients\/new\?lead=/, { timeout: 60000 });
      await page.waitForLoadState("networkidle");
      if ((await page.locator("#onb-q").inputValue()) === "") throw new Error("New client form not prefilled from the lead");
      await page.locator("button[type='submit']:has-text('Start managing')").click();
      await page.waitForURL(/\/clients\/(?!new)[^/?]+\?welcome=1&lead=1/, { timeout: 60000 });
      await page.waitForLoadState("networkidle");
      const t = await page.locator("main").innerText();
      if (!t.includes("Getting started")) throw new Error("no Getting started card");
      if (!t.includes("Owner adds Nora as Manager on the Google Business Profile")) throw new Error("google step missing");
      if (!t.includes("Get Instagram & TikTok access")) throw new Error("social step missing");
      if (!t.includes("Lead marked Won")) throw new Error("welcome banner missing");
      if (t.includes("Agree collab terms")) throw new Error("collab step shown though collab wasn't picked");
      const l = JSON.stringify(await tool("get_lead", { lead_id: leadId }));
      if (!l.includes('"stage":"won"') || !l.includes("convertedClientId")) throw new Error("lead not won/converted");
    });

    await step("Add business form creates a business with an onboarding checklist", async () => {
      await page.goto(`${BASE}/clients/new`, { waitUntil: "networkidle" });
      await page.fill("#onb-q", `Sample Taco Stand ${stamp}`);
      await page.fill("#onb-city", "Norfolk");
      for (const [v, on] of [["social", false], ["google", false], ["collab", true]]) await page.locator(`input[name='services'][value='${v}']`).setChecked(on, { force: true });
      await page.locator("button[type='submit']:has-text('Add client')").click();
      await page.waitForURL(/\/clients\/(?!new)[^/?]+\?welcome=1/, { timeout: 60000 });
      await page.waitForLoadState("networkidle");
      const t = await page.locator("main").innerText();
      if (!t.includes(`Sample Taco Stand ${stamp}`)) throw new Error("not on the new business page");
      if (!t.includes("Getting started") || !t.includes("Agree collab terms")) throw new Error("collab onboarding checklist missing");
      if (t.includes("Get Instagram & TikTok access")) throw new Error("social steps shown though social wasn't picked");
    });
  }

  /* ── hand-off: Home composer, quick-capture keys, ad hoc split, Nora's stats ── */
  if (process.env.MCP_TOKEN) {
    const composer = async (text, chip) => {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.locator("#quick-ask").fill(text);
      await page.locator("[role='radiogroup'][aria-label=\"Who's it for?\"] [role='radio']", { hasText: chip }).first().click();
      await page.locator("form:has(#quick-ask) button[type='submit']").click();
      await page.locator("form:has(#quick-ask) [role='status']").waitFor({ timeout: 30000 });
      const msg = await page.locator("form:has(#quick-ask) [role='status']").innerText();
      if (new URL(page.url()).pathname !== "/") throw new Error(`left Home: ${page.url()}`);
      if (await page.locator("#quick-ask").inputValue()) throw new Error("composer not cleared");
      return msg;
    };
    const qClaude = `Smoke composer ${stamp}: caption ideas for the crab boil`;
    await step("Home composer: Claude chip sends an ask without leaving Home", async () => {
      const msg = await composer(qClaude, /^Claude$/);
      if (!/Claude/.test(msg)) throw new Error(`unexpected confirmation: ${msg}`);
      const s = JSON.stringify(await tool("list_asks", {}));
      if (!s.includes(qClaude)) throw new Error("ask not visible via list_asks");
    });
    const qAdhoc = `Smoke adhoc ${stamp}: pick up the gift cards`;
    await step("Home composer: Ad hoc task chip puts a task on Cameron's list", async () => {
      const msg = await composer(qAdhoc, /^Ad hoc task$/);
      if (!/Cameron/.test(msg)) throw new Error(`unexpected confirmation: ${msg}`);
      const s = JSON.stringify(await tool("list_tasks", { assignee: "cameron", scope: "adhoc" }));
      if (!s.includes("Smoke adhoc " + stamp)) throw new Error("no ad hoc task for Cameron via list_tasks scope=adhoc");
      const plan = JSON.stringify(await tool("list_tasks", { assignee: "cameron", scope: "plan" }));
      if (plan.includes("Smoke adhoc " + stamp)) throw new Error("ad hoc task leaked into scope=plan");
    });

    let key = null;
    const capture = (body, headers = {}, token = key) =>
      fetch(`${BASE}/api/asks/capture`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body })
        .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    await step("settings/capture: make a key in the UI", async () => {
      await page.goto(`${BASE}/settings/capture`, { waitUntil: "networkidle" });
      await page.fill("#cap-label", `Smoke phone ${stamp}`);
      await page.locator("button[type='submit']:has-text('Make a key')").click();
      await page.locator("#cap-new-token").waitFor({ timeout: 30000 });
      key = await page.locator("#cap-new-token").inputValue();
      if (!/^nhq_/.test(key)) throw new Error(`bad key: ${key}`);
    });
    const cText = `Smoke capture ${stamp}: post the new hours`;
    await step("capture API: JSON route=cameron → task for Cameron", async () => {
      const r = await capture(JSON.stringify({ text: cText, route: "cameron" }), { "content-type": "application/json" });
      if (r.status !== 200 || !r.json?.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.json)}`);
      const s = JSON.stringify(await tool("list_tasks", { assignee: "cameron" }));
      if (!s.includes(`Smoke capture ${stamp}`)) throw new Error("no Cameron task for the captured ask");
    });
    await step("capture API: multipart with a JPEG → ask with attachment", async () => {
      const jp = await context.newPage();
      await jp.setContent("<body style='margin:0;background:#c33'></body>");
      const jpeg = await jp.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 8, height: 8 } });
      await jp.close();
      const fd = new FormData();
      const t = `Smoke photo ${stamp}: new bowl`;
      fd.set("text", t);
      fd.set("route", "claude");
      fd.append("file", new Blob([jpeg], { type: "image/jpeg" }), "bowl.jpg");
      const r = await capture(fd);
      if (r.status !== 200 || !r.json?.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.json)}`);
      const asks = await tool("list_asks", { limit: 100 });
      const list = Array.isArray(asks) ? asks : asks.asks ?? asks.items ?? [];
      const a = list.find((x) => x.body?.includes(t)) ?? null;
      if (!a) throw new Error("captured ask not in list_asks");
      if (!a.attachments?.length || !/image\/jpeg/.test(a.attachments[0].contentType)) throw new Error(`no jpeg attachment: ${JSON.stringify(a.attachments)}`);
    });
    await step("capture API: bad key → 401", async () => {
      const r = await capture(JSON.stringify({ text: "nope" }), { "content-type": "application/json" }, "nhq_notarealkey0000000000000000000000000000000");
      if (r.status !== 401) throw new Error(`HTTP ${r.status}`);
      const r2 = await capture(JSON.stringify({ text: "nope" }), { "content-type": "application/json" }, null);
      if (r2.status !== 401) throw new Error(`no auth: HTTP ${r2.status}`);
    });
    await step("capture API: turned-off key → 401", async () => {
      await page.goto(`${BASE}/settings/capture`, { waitUntil: "networkidle" });
      page.once("dialog", (d) => d.accept());
      const row = page.locator("li, tr, div", { hasText: `Smoke phone ${stamp}` }).filter({ has: page.locator("button:has-text('Turn off')") }).last();
      await row.locator("button:has-text('Turn off')").click();
      await page.locator(`text=Smoke phone ${stamp}`).waitFor({ state: "detached", timeout: 15000 });
      const r = await capture(JSON.stringify({ text: "after revoke" }), { "content-type": "application/json" });
      if (r.status !== 401) throw new Error(`HTTP ${r.status}`);
    });

    const adhocTitle = `Smoke one-off ${stamp}`;
    await step("business page: Ad hoc vs monthly checklist split", async () => {
      await tool("create_task", { client_id: "crab-o-clock", title: adhocTitle, assignee: "nora" });
      await page.goto(`${BASE}/clients/crab-o-clock`, { waitUntil: "networkidle" });
      const btn = page.locator("button:has-text(\"Create this month's checklist\")");
      if (await btn.count()) {
        await btn.first().click();
        await page.waitForFunction(() => !document.body.innerText.includes("Create this month's checklist"), null, { timeout: 30000 });
        await page.reload({ waitUntil: "networkidle" });
      }
      const t = await page.locator("main").innerText();
      if (!/checklist/i.test(t) || !/Ad hoc/i.test(t)) throw new Error("no 'checklist' + 'Ad hoc' sections");
      const iAd = t.search(/\nAd hoc/i); const iTitle = t.indexOf(adhocTitle);
      if (iAd < 0 || iTitle < iAd) throw new Error("ad hoc task not under the Ad hoc heading");
      await page.goto(`${BASE}/tasks?scope=plan&client=crab-o-clock&view=list`, { waitUntil: "networkidle" });
      if (await page.locator(`text=${adhocTitle}`).count()) throw new Error("ad hoc task shows in Monthly plan scope");
      await page.goto(`${BASE}/tasks?scope=adhoc&client=crab-o-clock&view=list`, { waitUntil: "networkidle" });
      if (!(await page.locator(`text=${adhocTitle}`).count())) throw new Error("ad hoc task missing from Ad hoc scope");
    });

    await step("/stats: log today's numbers for Instagram + TikTok", async () => {
      await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
      const ig = page.locator("#instagram_followers");
      if (!(await ig.isVisible())) await page.locator("summary", { hasText: /Log/i }).first().click();
      await ig.fill("23,456");
      await page.fill("#instagram_views", "345k");
      await page.fill("#tiktok_followers", "8,765");
      await page.locator("button[type='submit']:has-text(\"Save today's numbers\")").click();
      await page.locator("text=Saved Instagram and TikTok").waitFor({ timeout: 30000 });
      await page.reload({ waitUntil: "networkidle" });
      const t = await page.locator("main").innerText();
      for (const n of ["23,456", "8,765"]) if (!t.includes(n)) throw new Error(`${n} not shown on /stats`);
    });
    await step("mcp get_creator_stats returns the logged numbers", async () => {
      const s = JSON.stringify(await tool("get_creator_stats", {}));
      if (!s.includes("23456") || !s.includes("8765")) throw new Error(`numbers missing: ${s.slice(0, 300)}`);
    });
  }

  for (const e of errors) fail(`flows: ${e}`);
  await context.close();
}

/* ── Nora's section, the public collab form, quick onboarding ── */
const randIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

/** Fills all three steps of /collab like a person would and sends it. Returns the text shown after sending. */
async function fillCollab(page, opts) {
  for (let attempt = 0; ; attempt++) {
    try { return await fillCollabOnce(page, opts); } catch (e) {
      if (attempt >= 2 || opts.sent?.flag) throw e;
      await waitForServer();
    }
  }
}
async function tick(page, sel) {
  const box = page.locator(sel).first();
  if (await box.isChecked()) return;
  await page.locator(`label:has(${sel})`).first().click();
  if (!(await box.isChecked())) await box.check({ force: true });
}
async function fillCollabOnce(page, { business, contact = "Test Person", email, honeypot = false, wait = 4300, sent }) {
  await page.goto(`${BASE}/collab`, { waitUntil: "networkidle" });
  const t0 = Date.now();
  await page.fill("input[name='businessName']", business);
  await page.fill("input[name='contactName']", contact);
  await page.fill("input[name='email']", email);
  await page.fill("input[name='city']", "Testville");
  await page.fill("input[name='instagram']", `@test_${business.replace(/\W+/g, "_").toLowerCase().slice(-24)}`);
  if (honeypot) await page.evaluate(() => { const h = document.querySelector("input[name='homepage']"); if (h) h.value = "http://spam.example"; });
  await page.locator("button:has-text('Next')").click();
  await tick(page, "input[name='interests'][value='dine_in']");
  await tick(page, "input[name='deliverables'][value='ig_reel']");
  await tick(page, "input[name='compensation'][value='paid']");
  await page.locator("select[name='budget']").selectOption("500_1000");
  await page.locator("button:has-text('Next')").click();
  await page.fill("textarea[name='special']", "Smoke test only - fake sample data. Wood-fired test dumplings.");
  await tick(page, "input[name='ackDisclosure']");
  await tick(page, "input[name='ackHonest']");
  const left = wait - (Date.now() - t0);
  if (left > 0) await page.waitForTimeout(left);
  await page.locator("button[type='submit']:has-text('Send request')").click();
  if (sent) sent.flag = true;
  const done = page.locator("text=/Thanks, |Looks like a few requests|need a look|Something went wrong/").first();
  await done.waitFor({ timeout: 30000 });
  return done.innerText();
}

async function noraFlows(browser) {
  console.log("\n== nora: collab form, Nora's section, quick onboarding");
  const stamp = Date.now().toString(36);
  const ip = randIp();
  const pub = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const pp = await pub.newPage();
  const pubErrs = watch(pp).errors;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await login(context);
  const page = await context.newPage();
  const { errors } = watch(page);
  page.setDefaultTimeout(30000);

  const biz = `Smoke Test Kitchen ${stamp}`;
  let reqId = "", leadId = "";
  await step("/collab logged out: 3 steps → thank-you", async () => {
    const msg = await fillCollab(pp, { business: biz, email: `test+${stamp}@example.com`, sent: {} });
    if (!/Thanks, Test!/.test(msg)) throw new Error(`no thank-you: ${msg}`);
    if (new URL(pp.url()).pathname !== "/collab") throw new Error(`redirected to ${pp.url()}`);
  });
  await step("request shows in /collabs, Nora's section, For Nora asks and as a collab lead", async () => {
    await page.goto(`${BASE}/collabs`, { waitUntil: "networkidle" });
    const a = page.locator(`a[href^='/collabs/']`, { hasText: biz }).first();
    await a.waitFor({ timeout: 15000 });
    reqId = (await a.getAttribute("href")).split("/").pop().split("?")[0];
    await page.goto(`${BASE}/clients/noraeatsgood`, { waitUntil: "networkidle" });
    if (!(await page.locator(`text=${biz}`).count())) throw new Error("not on Nora's Collab requests card");
    await page.goto(`${BASE}/asks?tab=nora`, { waitUntil: "networkidle" });
    if (!(await page.locator(`text=${biz}`).count())) throw new Error("no ask in For Nora");
    const r = await tool("get_collab_request", { id: reqId });
    leadId = r.leadId ?? r.request?.leadId ?? "";
    if (!leadId) throw new Error(`no leadId: ${JSON.stringify(r).slice(0, 300)}`);
    const l = JSON.stringify(await tool("get_lead", { lead_id: leadId }));
    if (!l.includes('"collab"') || !l.includes('"stage":"qualified"')) throw new Error(`lead not a qualified collab lead: ${l.slice(0, 300)}`);
    await page.goto(`${BASE}/leads?opp=collab`, { waitUntil: "networkidle" });
    if (!(await page.locator(`text=${biz}`).count())) throw new Error("not on /leads?opp=collab");
  });
  await step("Home: Nora's card first, with the new-requests chip", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const first = page.locator("main a[href^='/clients/']").filter({ hasNotText: /^New client$/ }).first();
    const href = await first.getAttribute("href");
    if (href !== "/clients/noraeatsgood") throw new Error(`first business card is ${href}`);
    if (!(await page.locator("a[href='/collabs']", { hasText: /new collab request/ }).count())) throw new Error("no 'new collab requests' chip");
  });
  await step("honeypot-filled submit looks fine but stores nothing", async () => {
    const bot = `Smoke Bot Diner ${stamp}`;
    const p2 = await pub.newPage();
    const msg = await fillCollab(p2, { business: bot, email: `bot+${stamp}@example.com`, honeypot: true });
    await p2.close();
    if (!/Thanks/.test(msg)) throw new Error(`bot didn't see thank-you: ${msg}`);
    const list = JSON.stringify(await tool("list_collab_requests", { limit: 100 }));
    if (list.includes(bot)) throw new Error("honeypot submission was stored");
  });
  await step("too-fast submit (<4s) is dropped silently", async () => {
    const fast = `Smoke Fast Diner ${stamp}`;
    const p2 = await pub.newPage();
    const msg = await fillCollab(p2, { business: fast, email: `fast+${stamp}@example.com`, wait: 0 });
    await p2.close();
    if (!/Thanks/.test(msg)) throw new Error(`no thank-you: ${msg}`);
    if (JSON.stringify(await tool("list_collab_requests", { limit: 100 })).includes(fast)) throw new Error("too-fast submission was stored");
  });
  await step("6th submit from the same IP within an hour is rate-limited", async () => {
    let last = "";
    for (let i = 2; i <= 6; i++) {
      const p2 = await pub.newPage();
      last = await fillCollab(p2, { business: `Smoke Rate Cafe ${stamp} #${i}`, email: `rate${i}+${stamp}@example.com`, sent: {} });
      await p2.close();
      if (i < 6 && !/Thanks/.test(last)) throw new Error(`submit ${i} refused early: ${last}`);
    }
    if (!/Looks like a few requests/.test(last)) throw new Error(`6th not limited: ${last}`);
    const list = JSON.stringify(await tool("list_collab_requests", { limit: 100 }));
    if (list.includes(`Smoke Rate Cafe ${stamp} #6`)) throw new Error("6th request was stored");
    // a different address is still welcome
    const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randIp() } });
    const op = await other.newPage();
    const m = await fillCollab(op, { business: `Smoke Other Cafe ${stamp}`, email: `other+${stamp}@example.com` });
    await other.close();
    if (!/Thanks/.test(m)) throw new Error(`other IP refused: ${m}`);
  });
  await step("/collabs/[id]: Accept → lead Talking, request Accepted", async () => {
    await page.goto(`${BASE}/collabs/${reqId}`, { waitUntil: "networkidle" });
    const t = await page.locator("main").innerText();
    if (!t.includes(biz) || !t.includes("Wood-fired test dumplings")) throw new Error("answers not shown");
    await page.locator("button:has-text('Accept')").first().click();
    await page.locator("text=/Accepted/").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const l = JSON.stringify(await tool("get_lead", { lead_id: leadId }));
    if (!l.includes('"stage":"talking"')) throw new Error(`lead not talking: ${l.slice(0, 300)}`);
    const r = JSON.stringify(await tool("get_collab_request", { id: reqId }));
    if (!r.includes('"status":"accepted"')) throw new Error("request not accepted");
  });
  await step("/collabs stays private when logged out", async () => {
    const res = await pp.goto(`${BASE}/collabs`, { waitUntil: "networkidle" });
    if (!new URL(pp.url()).pathname.startsWith("/login")) throw new Error(`not redirected to login (HTTP ${res?.status()}, ${pp.url()})`);
  });

  await step("/clients/new: pasted Instagram link + name → business, IG handle, checklist, Claude ask", async () => {
    const name = `Sample Tacos ${stamp}`;
    await page.goto(`${BASE}/clients/new`, { waitUntil: "networkidle" });
    await page.fill("#onb-q", "https://www.instagram.com/sampletacos/");
    await page.locator("#onb-name").waitFor();
    if (!(await page.locator("text=sampletacos").count())) throw new Error("no parsed-handle chip");
    await page.fill("#onb-name", name);
    await page.fill("#onb-city", "Testville");
    await page.locator("button[type='submit']:has-text('Add client')").click();
    await page.waitForURL(/\/clients\/(?!new)[^/?]+\?welcome=1/, { timeout: 60000 });
    await page.waitForLoadState("networkidle");
    const t = await page.locator("main").innerText();
    if (!t.includes(name)) throw new Error("not on the new business page");
    if (!t.includes("is set up")) throw new Error("no welcome banner");
    if (!t.includes("@sampletacos")) throw new Error("IG handle not saved");
    if (!t.includes("Getting started") || !t.includes("Kickoff call")) throw new Error("onboarding checklist missing");
    const asks = JSON.stringify(await tool("list_asks", { limit: 100 }));
    if (!asks.includes(name)) throw new Error("no Claude ask for the new business");
  });
  await step("/clients/new?lead=<id> converts a lead", async () => {
    const lead = await tool("add_lead", { name: `Sample Bao Bar ${stamp}`, city: "Testville", website: `https://sample-bao-${stamp}.example.com`, opportunities: ["social"] });
    await page.goto(`${BASE}/clients/new?lead=${lead.leadId}`, { waitUntil: "networkidle" });
    if (!(await page.locator("#onb-q").inputValue()).includes("Sample Bao Bar")) throw new Error("name not prefilled");
    await page.locator("button[type='submit']:has-text('Start managing')").click();
    await page.waitForURL(/\/clients\/(?!new)[^/?]+\?welcome=1&lead=1/, { timeout: 60000 });
    const l = JSON.stringify(await tool("get_lead", { lead_id: lead.leadId }));
    if (!l.includes('"stage":"won"') || !l.includes("convertedClientId")) throw new Error(`lead not won: ${l.slice(0, 300)}`);
    // double submit is safe: revisiting redirects to the business
    await page.goto(`${BASE}/clients/new?lead=${lead.leadId}`, { waitUntil: "networkidle" });
    if (new URL(page.url()).pathname === "/clients/new") throw new Error("converted lead didn't redirect to its business");
  });
  await step("Nora is pinned, not in the Businesses list", async () => {
    await page.goto(`${BASE}/clients`, { waitUntil: "networkidle" });
    const n = await page.locator("main a[href='/clients/noraeatsgood']").count();
    if (n !== 1) throw new Error(`${n} links to Nora on /clients (want 1 pinned)`);
    const sideBiz = await page.locator("aside a[href='/clients/noraeatsgood'], nav a[href='/clients/noraeatsgood']").count();
    if (sideBiz < 1) throw new Error("no pinned Nora entry in the sidebar");
    const listed = await page.evaluate(() => {
      const h = [...document.querySelectorAll("p")].find((p) => p.textContent?.trim() === "Businesses");
      const list = h?.parentElement?.parentElement;
      return list ? !!list.querySelector("a[href='/clients/noraeatsgood']") : null;
    });
    if (listed) throw new Error("Nora listed under Businesses in the sidebar");
    if (!(await page.locator("a[href='/clients/new']").count())) throw new Error("no New client link");
  });

  // `next dev` occasionally restarts itself near its memory limit; dropped connections aren't app bugs.
  for (const e of errors) if (!DEV_BLIP.test(e)) fail(`nora flows: ${e}`);
  for (const e of pubErrs) if (!DEV_BLIP.test(e)) fail(`nora flows (public): ${e}`);
  await pub.close();
  await context.close();
}

/* ── responsive QA: every route × 7 viewports × light/dark ── */
const RESP_VIEWPORTS = [
  { name: "375", width: 375, height: 667, touch: true },
  { name: "390", width: 390, height: 844, touch: true },
  { name: "430", width: 430, height: 932, touch: true },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1920", width: 1920, height: 1080 },
];

async function detailRoutes(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await login(context);
  const page = await context.newPage();
  const out = [];
  for (const [list, sel] of [
    ["/creators?view=table", "a[href^='/creators/']:not([href='/creators/new']):not([href^='/creators/export']):not([href^='/creators/import'])"],
    ["/tasks?status=all&view=list", "a[href^='/tasks/']:not([href^='/tasks/import']):not([href^='/tasks/export'])"],
    ["/asks", "a[href^='/asks/']:not([href='/asks/new'])"],
    ["/calendar", "a[href^='/calendar/']:not([href^='/calendar/new'])"],
    ["/review", "a[href^='/review?draft=']"],
    ["/leads", "a[href^='/leads/']:not([href='/leads/new']):not([href^='/leads/import']):not([href^='/leads/export'])"],
    ["/collabs", "a[href^='/collabs/']"],
  ]) {
    await page.goto(BASE + list, { waitUntil: "networkidle" });
    const href = await page.locator(sel).first().getAttribute("href").catch(() => null);
    if (href) out.push(href);
  }
  await context.close();
  return out;
}

// Runs inside the page. Returns { overflow, smallFonts, smallTargets, covered }.
function auditPage(touch) {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    if (el.closest("dialog:not([open]), [hidden], [aria-hidden='true']")) return false;
    const d = el.closest("details:not([open])");
    if (d && !el.closest("summary")) return false; // closed <details> content still has boxes in Chromium
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true })) return false;
    return true;
  };
  const desc = (el) => {
    const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${t ? ` "${t}"` : ""}`;
  };
  const res = { overflow: null, smallFonts: [], smallTargets: [], covered: null };
  const sw = document.documentElement.scrollWidth, iw = window.innerWidth;
  if (sw > iw + 1) {
    const culprits = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > iw + 1 && r.width > 0 && vis(el)) culprits.push(`${desc(el)} .${String(el.className).slice(0, 50)} right=${Math.round(r.right)}`);
      if (culprits.length > 2) break;
    }
    res.overflow = `${sw} > ${iw}: ${culprits.join(" | ")}`;
  }
  if (!touch) return res;
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (["checkbox", "radio", "hidden", "file", "range", "color", "submit", "button"].includes(el.type)) continue;
    if (!vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) res.smallFonts.push(`${desc(el)} ${fs}px`);
  }
  for (const el of document.querySelectorAll("button, [role=button], [role=tab], summary, a, input[type=submit]")) {
    if (!vis(el)) continue;
    if (el.closest("nav[aria-label='Breadcrumb']")) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === "A") {
      const styled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0;
      if (cs.display === "inline" || (!styled && !el.closest("nav"))) continue; // inline / plain text links are allowed
    }
    let h = el.getBoundingClientRect().height;
    const tt = el.closest(".tap-target");
    if (tt) h = Math.max(h, parseFloat(getComputedStyle(tt, "::after").height) || 0);
    // a control wrapped in a tall label/row counts by its hit box
    const lab = el.closest("label");
    if (lab) h = Math.max(h, lab.getBoundingClientRect().height);
    if (h < 40) res.smallTargets.push(`${desc(el)} ${Math.round(h)}px`);
  }
  const bar = [...document.querySelectorAll("nav")].find((n) => getComputedStyle(n).position === "fixed" && vis(n));
  const main = document.querySelector("main");
  if (bar && main) {
    const top = bar.getBoundingClientRect().top;
    let maxB = -1, who = null;
    for (const el of main.querySelectorAll("*")) {
      if (!vis(el) || el.children.length) continue;
      let skip = false, b = el.getBoundingClientRect().bottom;
      for (let a = el; a && a !== main; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.position === "fixed" || s.position === "sticky" || a.tagName === "DIALOG") { skip = true; break; }
        if (a !== el && s.overflowY !== "visible") b = Math.min(b, a.getBoundingClientRect().bottom);
      }
      if (!skip && b > maxB) { maxB = b; who = el; }
    }
    if (who && maxB > top + 1) res.covered = `${desc(who)} bottom=${Math.round(maxB)} > tabbar top=${Math.round(top)}`;
  }
  return res;
}

const DEV_BLIP = /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_EMPTY_RESPONSE|webpack-hmr|Failed to fetch RSC payload|interrupted by another navigation|chrome-error:/;
async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/login`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function responsive(browser) {
  console.log("\n== responsive");
  const routes = [...ROUTES, ...(await detailRoutes(browser))];
  const found = new Map(); // message -> Set(viewport)
  const note = (msg, where) => { if (!found.has(msg)) found.set(msg, new Set()); found.get(msg).add(where); };
  let pages = 0;
  const combos = RESP_VIEWPORTS.flatMap((vp) => ["light", "dark"].map((scheme) => ({ vp, scheme })));
  const runCombo = async ({ vp, scheme }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: scheme,
      isMobile: !!vp.touch, hasTouch: !!vp.touch,
    });
    const pub = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: scheme,
      isMobile: !!vp.touch, hasTouch: !!vp.touch,
    });
    await login(context);
    for (const [ctx, list] of [[context, routes], [pub, PUBLIC_ROUTES]]) {
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
    for (const path of list) {
      const where = `${vp.name}${scheme === "dark" ? "d" : ""}`;
      let res, a, navErr = null;
      // `next dev` restarts itself when it nears its memory limit; that drops connections mid-run.
      // Wait for it to come back and retry the page instead of reporting a dev-server blip as an app bug.
      for (let attempt = 0; attempt < 3; attempt++) {
        errs.length = 0; navErr = null;
        try {
          res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 });
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(120);
          a = await page.evaluate(auditPage, !!vp.touch);
        } catch (e) { navErr = e.message.split("\n")[0]; }
        const blip = (navErr && DEV_BLIP.test(navErr)) || errs.some((e) => DEV_BLIP.test(e));
        if (!blip) break;
        await waitForServer();
      }
      if (navErr) { note(`${path}: navigation ${navErr}`, where); continue; }
      if (res?.status() !== 200) note(`${path}: HTTP ${res?.status()}`, where);
      pages++;
      if (a.overflow) note(`${path}: horizontal overflow ${a.overflow.replace(/\d+ > \d+: /, "")}`, where);
      for (const f of a.smallFonts) note(`${path}: input font < 16px: ${f}`, where);
      for (const t of a.smallTargets) note(`${path}: tap target < 40px: ${t}`, where);
      if (a.covered) note(`${path}: tab bar covers content: ${a.covered.replace(/bottom=\d+ > tabbar top=\d+/, "")}`, where);
      for (const e of errs) note(`${path}: console error: ${e}`, where);
    }
    }
    await context.close();
    await pub.close();
  };
  const queue = [...combos];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await runCombo(queue.shift()); }));
  for (const [msg, where] of found) fail(`responsive ${msg} [${[...where].join(",")}]`);
  console.log(`  checked ${pages} page loads (${routes.length} routes + ${PUBLIC_ROUTES.length} logged-out × ${combos.length} viewport/scheme combos)`);
}

const browser = await chromium.launch();
try {
  if (MODE === "crawl" || MODE === "all") await crawl(browser);
  if (MODE === "flows" || MODE === "all") await flows(browser);
  if (MODE === "flows" || MODE === "all" || MODE === "nora") await noraFlows(browser);
  if (MODE === "responsive") await responsive(browser);
  if (process.env.SHOTS_DIR) await shots(browser, process.env.SHOTS_DIR);
} finally {
  await browser.close();
}
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : "ALL PASSED"}`);
process.exit(failures.length ? 1 : 0);
