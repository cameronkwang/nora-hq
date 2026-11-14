/**
 * Checks for src/lib/credential-guard.ts — no test framework, just: npx tsx scripts/test-credential-guard.ts
 * Exits non-zero on the first wrong answer.
 */
import { hasSecret, looksLikeSecret, looksLikeTypedSecret, maskSecret, redactSecrets } from "../src/lib/credential-guard";

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
  // Full-width characters from a Chinese keyboard, and a password with Chinese straight after it.
  "密码：１２３４５６",
  "ｐａｓｓｗｏｒｄ：ｈｕｎｔｅｒ２",
  "密码是Tanklin1991!!谢谢",
  "密码是我的生日19880808",
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
  // Chinese right after a label is someone talking, a trailing "?" is a question, a plain price is a price.
  "Google 的密码是我儿子管的",
  "我忘了Facebook的密码怎么办",
  "what is the password for?",
  "Lunch pass: $50 a month",
  "Password: forgot",
  "I forgot my password: can you help",
  "我们有WiFi和2楼包厢！欢迎光临～",
  // A link or #hashtag with Chinese inside stays one word.
  "https://www.dropbox.com/scl/fo/abc/照片?rlkey=x7Yz1&dl=0",
  "#金龙Wok2020!",
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
  // One word after "password:" only counts when it ends the line; more words is someone talking.
  "password: can you help",
  "password: same as Facebook",
  "password: forgot",
  "Facebook password: lost",
  "the password is wrong",
  "I don't know what my password is anymore",
  "Forgot password - Lily",
  "Please help me reset my password:\nThanks",
  "Day pass: free",
  "密码：忘记了",
  "密码是iPhone自动保存的",
  "Instagram的密码和Facebook一样",
  "账号是我儿子开的，密码他知道",
  "帳號密碼都在我先生那裡",
  "登录不了，一直说密码错误！",
  "我们有WiFi和2楼包厢！欢迎光临～",
  // Accounts without a password.
  "Our Instagram is @goldenwok / TikTok @goldenwok.rva",
  "IG: goldenwok / FB: Golden Wok RVA",
  "关注我们的账号 @goldenwok 有优惠",
  "Email us at deals@goldenwok.com for catering",
  // "password is …" that says what the password is like, not what it is.
  "my password is wrong",
  "password is required",
  "my password was hacked",
  "the password is expired.",
  "password is: can you help",
  // One word after "password:" that is someone talking ("Password: Google" = they sign in with Google).
  "Password: Google",
  "Password: email",
  "Password: Gmail",
  "Password: thanks",
  "password: okay",
  "password: sure",
  "password: pending",
  "password: dunno",
  "Password: resetting",
  // A link or #hashtag with Chinese inside stays one word.
  "https://www.dropbox.com/scl/fo/abc/照片?rlkey=x7Yz1&dl=0",
  "#金龙Wok2020!",
];
// The same form's deal / anything-else boxes (and the drop note) also skip the bare-word rule.
const TYPED_CLEAN_PROSE = [
  "Buy1Get1! on Tuesdays", "2for$10! lunch", "BOGO50%off! all week", "小籠包、牛肉麵；周一到周五午餐特价 Buy1Get1!",
  "Use code SAVE20NOW! this week, ends Sunday",
  "周末特价：买一送一！Buy1Get1!",
  "lunch/dinner 2for$10!",
  "Deals: 2for$10! / Buy1Get1!",
  // A deal that mentions an account is still a deal.
  "Season pass holders get 2for$10!",
  "Follow our account @goldenwok for Buy1Get1!",
  "Create an account and get SAVE20NOW!",
  "Log in to our app for Buy1Get1!",
  "Order online, no account needed: Buy1Get1!",
  // An account word, a login or a slash in deal text (Chinese has no spaces, so the deal is often the second "word").
  "会员账户每周二 Buy1Get1!",
  "會員帳號：每週二 Buy1Get1!",
  "登录APP下单 Buy1Get1!",
  "关注账号送饮料 Buy1Get1!",
  "用微信账号登录下单 2for$10!",
  "Loyalty account: buy10get1!",
  "Rewards account: Free1Drink! after 10 visits",
  "Pass holders: 2for$10!",
  "Happy hour 3-6pm / 2for$10! drinks",
  "BOGO / Buy1Get1! all week",
  "App login: get Free1Drink!",
];
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
  // After a password label and a colon (or 是), one word that ends the line is the password whatever it looks like.
  "ig password: goldenwok",
  "ig password: goldenwok.",
  "Instagram 密码：woaini",
  "facebook密码是goldenwok",
  "pw: dragonwok",
  "password: Goldenwok",
  "passcode: sesame",
  "Facebook\nusername: goldenwok\npassword: woaini",
  "Instagram账号是pokebros，密码是woaini",
  // The same with "is" in place of the colon.
  "our ig password is goldenwok",
  "IG password is woaini",
  "the password is goldenwok",
  "password was goldenwok",
  "password is: goldenwok",
  // Full-width characters, and a password with Chinese straight after it.
  "密码：１２３４５６",
  "ｐａｓｓｗｏｒｄ：ｇｏｌｄｅｎｗｏｋ",
  "密码是Tanklin1991!!谢谢",
  "密码是我的Tanklin1991!!",
  // A password-shaped word right after an account: refused in the deal / anything-else boxes and the drop note too.
  "IG: goldenwok / Wok2020!",
  "ig goldenwok/Wok2020!",
  "our ig is goldenwok pass Wok2020!",
  "ig goldenwok pass Wok2020!",
  "IG login: goldenwok / Wok2020!",
  "账号密码：pokebros Tanklin1991!!",
  "账号密码：craboclock Tanklin1991!!",
  "IG login: pokebros@gmail.com / Tanklin1991!!",
  "login: craboclock@gmail.com / Tanklin1991!!",
  "our instagram login: craboclock / Tanklin1991!!",
  "FB login craboclock@gmail.com Tanklin1991!!",
  "账号 craboclock@gmail.com Tanklin1991!!",
  "账号pokebros密码Tanklin1991!!",
  "username: pokebros Tanklin1991!!",
  "pokebros@gmail.com Tanklin1991!!",
  "the password to our IG is Tanklin1991!!",
  "password for the wifi: Wok2020!",
  "密码：我们店的是 Tanklin1991!!",
  "login goldenwok Wok2020!",
  "账号：goldenwok Wok2020!",
  "微信号 goldenwok88 / Wok2020!",
  "IG account: Tanklin1991!!",
  "account: goldenwok Wok2020!",
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
// What Claude and phones read (redactSecrets, the jumpy check): no password a public form could have let through.
const PASSWORDS = ["Tanklin1991", "Wok2020", "Wok2024", "woaini", "dragonwok", "sesame", "hunter2", "Secret99", "Noodle2024", "abc12345", "hrimp888", "１２３４５６", "ｇｏｌｄｅｎｗｏｋ", "Goldenwok", "goldenwok"];
const READ_MASKED: [string, string][] = [
  ...TYPED_SECRET.map((t): [string, string] => [t, PASSWORDS.find((p) => t.includes(p)) ?? t]),
  // What the calm form check lets through on purpose is still masked on the way out.
  ["password: goldenwok thanks", "goldenwok"],
  ["密码：woaini，谢谢", "woaini"],
  ["pass: goldenwok", "goldenwok"],
  ["IG: pokebros Tanklin1991!!", "Tanklin1991"],
  ["use Tanklin1991!! for both", "Tanklin1991"],
  ["Password: Google", "Google"],
  ["password is gmail", "gmail"],
];
for (const [t, secret] of READ_MASKED) {
  const r = redactSecrets(t) ?? "";
  if (r.includes(secret) || !r.includes("[password removed: ")) { failed++; console.error(`✗ redactSecrets still shows ${JSON.stringify(secret)}: ${JSON.stringify(r)}`); }
  else console.log(`✓ masked for Claude ${JSON.stringify(t)} → ${JSON.stringify(r)}`);
}
// Only the password is swapped; everything else stays exactly as typed (full-width punctuation included).
const READ_EXACT: [string, string][] = [
  ["密码：１２３４５６", "密码：[password removed: １••••６]"],
  ["Instagram账号是pokebros，密码是woaini。谢谢！", "Instagram账号是pokebros，密码是[password removed: w••••i]。谢谢！"],
  ["密码是Tanklin1991!!谢谢", "密码是[password removed: T••••••••!]谢谢"],
  ["密码是我的生日19880808", "密码是我的生日[password removed: 1••••••8]"],
  // Jumpy on purpose: a deal written as one word is masked too (the team still sees it as typed).
  ["Buy1Get1! on Tuesdays", "[password removed: B•••••••!] on Tuesdays"],
  ["小籠包、牛肉麵；周一到周五午餐特价 Buy1Get1! on Tuesdays, 2for$10! lunch", "小籠包、牛肉麵；周一到周五午餐特价 [password removed: B•••••••!] on Tuesdays, [password removed: 2••••••!] lunch"],
];
for (const [t, want] of READ_EXACT) {
  const r = redactSecrets(t);
  if (r !== want) { failed++; console.error(`✗ redactSecrets(${JSON.stringify(t)}) → ${JSON.stringify(r)}, expected ${JSON.stringify(want)}`); }
  else console.log(`✓ masked for Claude ${JSON.stringify(t)} → ${JSON.stringify(r)}`);
}
// Ordinary answers reach Claude as typed.
const READ_AS_TYPED = [
  "我忘了Facebook的密码怎么办", "Instagram密码忘记了，需要帮忙", "Google 的密码是我儿子管的", "不用给密码就可以吗？", "臉書的密碼我不記得了",
  "what is the password for?", "I forgot my password: can you help", "My Instagram password: same as Facebook", "Lunch pass: $50 a month", "我们有WiFi和2楼包厢！欢迎光临～",
  "小籠包、牛肉麵；周一到周五午餐特价", "BOGO boba this week, ends Sunday", "微信号 wok8888，电话 804-555-0100",
  "my password is wrong", "password is required", "I don't know what my password is anymore",
  "https://www.dropbox.com/scl/fo/abc/照片?rlkey=x7Yz1&dl=0", "#金龙Wok2020!",
];
for (const t of READ_AS_TYPED) {
  const r = redactSecrets(t);
  if (r !== t) { failed++; console.error(`✗ redactSecrets changed an ordinary answer: ${JSON.stringify(t)} → ${JSON.stringify(r)}`); }
  else console.log(`✓ Claude reads as typed ${JSON.stringify(t)}`);
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
console.log(`\nAll ${SECRET.length + CLEAN.length + TYPED_CLEAN.length + TYPED_CLEAN_PROSE.length + TYPED_SECRET.length + TYPED_SECRET_TOKEN.length + READ_MASKED.length + READ_EXACT.length + READ_AS_TYPED.length} checks passed`);
