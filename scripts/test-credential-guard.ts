/**
 * Checks for src/lib/credential-guard.ts — no test framework, just: npx tsx scripts/test-credential-guard.ts
 * Exits non-zero on the first wrong answer.
 */
import { hasSecret, looksLikeSecret, maskSecret } from "../src/lib/credential-guard";

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

let failed = 0;
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
console.log(`\nAll ${SECRET.length + CLEAN.length} checks passed`);
