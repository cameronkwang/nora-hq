/**
 * Checks for src/lib/credential-guard.ts — no test framework, just: npx tsx scripts/test-credential-guard.ts
 * Exits non-zero on the first wrong answer.
 */
import { hasSecret, looksLikeSecret, looksLikeTypedSecret, maskSecret } from "../src/lib/credential-guard";

const SECRET = [
  "Tanklin1991!!",
  "5006688@Fff",
  "IG login: Tanklin1991!!",
  "password: hunter2",
  "Password - sunshine",
  "pw hunter2",
  "pw: abc",
  "pass=Secret99",
  "login: owner@goldenwok.com",
  "The wifi password is Noodle2024",
  "FB passwords: Tanklin",
  "Instagram 密码：abc12345",
  "店的密碼 shrimp888",
  "Owner said use (Tanklin1991!!) for both",
];

const CLEAN = [
  "owner@goldenwok.com",
  "https://www.instagram.com/goldenwok/?hl=en",
  "goldenwok.com/menu",
  "$1,000.00",
  "$20/person, 3x/week",
  "@sf.massage.kingdom",
  "1-804-301-4537",
  "+1 (804) 301-4537",
  "Mon–Fri 11am–9pm",
  "Sat 11:30am-10pm!",
  "2026-11-13",
  "11/13/2026",
  "#RVAeats2024!",
  "50%OFF!",
  "accounts/123456789/locations/987654321",
  "dlv_ab12cd34ef56",
  "Logins go in the password manager. Never paste passwords into Nora HQ.",
  "Ask the owner to reset the password later.",
  "Password: none",
  "Remove it and use a password manager.",
  "Pass the sauce to table 4",
  "Google Maps: https://maps.app.goo.gl/AbC123xyz",
  "— Onboarding form received Nov 13, 2026 (answered in 简体) — the client's own answers are at /clients/golden-wok/intake —",
  "Access: Meta Done · Google Need help · TikTok ?",
  "请不要在表格里填写任何密码。",
  "Tone: warm, playful! Emojis: 1–2 per caption 🍜",
];

// The public onboarding form (looksLikeTypedSecret): an owner who only talks about a password must get through.
const TYPED_CLEAN = [
  "我忘了Facebook的密码怎么办",
  "Instagram密码忘记了，需要帮忙",
  "Google 的密码是我儿子管的",
  "不用给密码就可以吗？",
  "臉書的密碼我不記得了",
  "密码为什么不对",
  "I forgot my password: can you help",
  "I forgot my password: Can you help?",
  "what is the password for?",
  "My Instagram password: same as Facebook",
  "Password: none",
  "login: @goldenwok",
  "login: owner@goldenwok.com",
  "Lunch pass: $50 a month",
  "请不要在表格里填写任何密码。",
];
// The same form's deal / anything-else boxes also skip the bare-word rule.
const TYPED_CLEAN_PROSE = ["Buy1Get1! on Tuesdays", "2for$10! lunch", "BOGO50%off! all week", "小籠包、牛肉麵；周一到周五午餐特价 Buy1Get1!"];
// A real password is still refused, in every box.
const TYPED_SECRET = [
  "our ig password: Tanklin1991!!",
  "IG login: Tanklin1991!!",
  "password: hunter2",
  "pw hunter2",
  "pass=Secret99",
  "The wifi password is Noodle2024",
  "Instagram 密码：abc12345",
  "Instagram的密码是Tanklin1991!!",
  "臉書密碼：Shrimp888",
  "店的密碼 shrimp888",
  "账号密码: golden/Wok2024",
];
// Outside the prose boxes a bare password-shaped word is refused too.
const TYPED_SECRET_TOKEN = ["Tanklin1991!!", "use 5006688@Fff for both"];

let failed = 0;
for (const t of TYPED_CLEAN) {
  for (const tokens of [true, false]) {
    const m = looksLikeTypedSecret(t, { tokens });
    if (m.length) { failed++; console.error(`✗ owner form false positive (tokens: ${tokens}): ${JSON.stringify(t)} → ${m.map((x) => `${x.kind}:${x.text}`).join(" | ")}`); }
  }
  console.log(`✓ owner form lets through ${JSON.stringify(t)}`);
}
for (const t of TYPED_CLEAN_PROSE) {
  const m = looksLikeTypedSecret(t, { tokens: false });
  if (m.length) { failed++; console.error(`✗ owner form (deal box) false positive: ${JSON.stringify(t)} → ${m.map((x) => `${x.kind}:${x.text}`).join(" | ")}`); }
  else console.log(`✓ owner form (deal box) lets through ${JSON.stringify(t)}`);
}
for (const t of TYPED_SECRET) {
  for (const tokens of [true, false]) {
    if (!looksLikeTypedSecret(t, { tokens }).length) { failed++; console.error(`✗ owner form missed a password (tokens: ${tokens}): ${JSON.stringify(t)}`); }
  }
  console.log(`✓ owner form refuses ${JSON.stringify(t)}`);
}
for (const t of TYPED_SECRET_TOKEN) {
  if (!looksLikeTypedSecret(t).length) { failed++; console.error(`✗ owner form missed a bare password: ${JSON.stringify(t)}`); }
  else console.log(`✓ owner form refuses ${JSON.stringify(t)}`);
}
for (const t of SECRET) {
  const m = looksLikeSecret(t);
  if (!m.length) { failed++; console.error(`✗ missed secret: ${JSON.stringify(t)}`); }
  else console.log(`✓ secret ${JSON.stringify(t)} → ${m.map((x) => x.hint).join(" | ")}`);
}
for (const t of CLEAN) {
  const m = looksLikeSecret(t);
  if (m.length) { failed++; console.error(`✗ false positive: ${JSON.stringify(t)} → ${m.map((x) => `${x.kind}:${x.text}`).join(" | ")}`); }
  else console.log(`✓ clean  ${JSON.stringify(t)}`);
}
// Hints never contain the whole secret.
for (const m of looksLikeSecret("password: Tanklin1991!! and 5006688@Fff")) {
  if (m.hint.includes(m.text)) { failed++; console.error(`✗ hint leaks the secret: ${m.hint}`); }
}
if (maskSecret("Tanklin1991!!") !== "T••••••••!") { failed++; console.error(`✗ mask: ${maskSecret("Tanklin1991!!")}`); }
if (hasSecret("") || hasSecret(null)) { failed++; console.error("✗ empty input"); }

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${SECRET.length + CLEAN.length + TYPED_CLEAN.length + TYPED_CLEAN_PROSE.length + TYPED_SECRET.length + TYPED_SECRET_TOKEN.length} checks passed`);
