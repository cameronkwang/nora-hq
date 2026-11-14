/**
 * Spots likely passwords / logins in free text (business notes, brand voice, anything Claude is asked to save).
 * Nora HQ never stores credentials — they belong in a password manager. Pure and dependency-free, so it runs
 * on the server (ops refuse to save) and in the browser (the Settings notes field warns as you type).
 *
 * Two kinds of match:
 *  - "labelled": a credential label followed by a value — "password: x", "pw hunter2", "pass=…", "login: …", "密码：…".
 *  - "token": one 8+ character word with letters AND digits AND a password-style symbol (!@#$%^&*…), that isn't an
 *    email, URL, @handle, #hashtag, phone number, price, date or opening hours ("Tanklin1991!!", "5006688@Fff").
 *
 * Callers must never echo `text` back to people or Claude — show `hint` (masked) instead.
 */

/** The warning shown on a business page / Settings when its notes look like they hold a password. */
export const PASSWORD_WARNING = "This business's notes look like they contain a password. Remove it and use a password manager.";

export type SecretMatch = {
  kind: "labelled" | "token";
  /** The raw matched value. Internal only — never display or log it. */
  text: string;
  /** Safe to show: the label (if any) plus a masked value, e.g. "password: T•••••••!". */
  hint: string;
};

/** Labels that mean "a password follows", even without a colon ("pw hunter2", "password is x"). */
const STRONG = "passwords|password|passwd|passcode|pwd|pw|密码|密碼|口令";
/** Labels that only count with a separator ("pass=x", "login: x"). */
const WEAK = "pass|login|log-in|signin|sign-in|账号密码|帳號密碼";

const STRONG_RE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${STRONG})(\\s*[:=：]\\s*|\\s*-\\s+|\\s+(?:is\\s+|was\\s+)?)([^\\s,;]+)`, "giu");
/** Chinese labels need no word boundary ("店的密码：…"). */
const CJK_RE = /(账号密码|帳號密碼|密码|密碼|口令)(\s*[:=：]?\s*)([^\s,;，。、]+)/gu;
const WEAK_RE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${WEAK})(\\s*[:=：]\\s*)([^\\s,;]+)`, "giu");

/** Words that follow "password" in ordinary sentences ("password manager", "password reset"). */
const NOT_A_VALUE = new Set([
  "manager", "managers", "reset", "resets", "change", "changed", "protected", "required", "needed", "later", "less",
  "in", "on", "at", "the", "a", "an", "for", "to", "with", "and", "or", "of", "from", "into", "via", "by",
  "none", "n/a", "na", "tbd", "tba", "unknown", "?", "-", "—", "ask", "see", "here", "there", "it", "them", "this", "that",
  "please", "never", "not", "no", "yes", "sent", "shared", "saved", "stored", "1password", "lastpass", "bitwarden", "keychain",
  "owner", "client", "nora", "cameron", "we", "they", "you", "he", "she", "manager.", "managers.", "hint", "hints",
]);

const PASSWORD_SYMBOL = /[!@#$%^&*?~+=<>{}[\]|\\]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)|^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]\S*)?$/i;
/** Words that make a token a time/date/quantity rather than a secret once removed ("11am–9pm", "Mon–Fri", "3x/week"). */
const BENIGN_WORDS = /(am|pm|st|nd|rd|th|k|x|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|min|mins|hr|hrs|h|lb|lbs|oz|ft|pcs|pc|off|ea|each|week|wk|mo|yr|day|days|per)/gi;

/** "Tanklin1991!!" → "T•••••••!" — enough to recognise, not enough to use. */
export function maskSecret(v: string): string {
  const s = [...v];
  if (s.length <= 2) return "•".repeat(s.length);
  return `${s[0]}${"•".repeat(Math.min(8, s.length - 2))}${s[s.length - 1]}`;
}

/** Trims wrapping punctuation people put around words: quotes, brackets, trailing full stops/commas. */
function trimToken(t: string): string {
  return t.replace(/^[("'“‘[<]+/, "").replace(/[)"'”’\]>,.;:。，、]+$/, "");
}

/** True for a standalone word that looks like a password (see file comment). */
export function isSecretToken(raw: string): boolean {
  const t = trimToken(raw);
  if ([...t].length < 8 || /\s/.test(t)) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t) || !PASSWORD_SYMBOL.test(t)) return false;
  if (/^[@#/]/.test(t)) return false; // @handle, #hashtag, /path
  if (EMAIL.test(t) || URLISH.test(t) || t.includes("://")) return false;
  if (/^[$€£¥]|^[A-Z]{3}\$|^\d[\d,.]*%/.test(t)) return false; // prices, percentages
  // Dates / times / quantities: nothing letter-like left once the usual unit words are gone.
  if (!/[A-Za-z]/.test(t.replace(BENIGN_WORDS, ""))) return false;
  return true;
}

function valueLooksSecret(label: string, value: string, separated: boolean): boolean {
  const v = trimToken(value);
  if (!v || NOT_A_VALUE.has(v.toLowerCase())) return false;
  if (EMAIL.test(v) && /^(login|log-in|signin|sign-in)$/i.test(label)) return true; // "login: owner@x.com" — a login, still not for here
  if (separated) return [...v].length >= 3;
  // No colon ("pw hunter2", "password is Tanklin1991"): the value has to look like one.
  return [...v].length >= 4 && (/\d/.test(v) || PASSWORD_SYMBOL.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)));
}

/** Every likely password/login in `text` (empty when clean). Never show `text` of a match — use `hint`. */
export function looksLikeSecret(text: string | null | undefined): SecretMatch[] {
  if (!text || !text.trim()) return [];
  const out: SecretMatch[] = [];
  const seen = new Set<string>();
  const push = (m: SecretMatch) => {
    if (seen.has(m.text)) return;
    seen.add(m.text);
    out.push(m);
  };

  for (const re of [STRONG_RE, WEAK_RE, CJK_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const label = m[1];
      const value = trimToken(m[3]);
      const separated = /[:=：-]/.test(m[2]) || re === CJK_RE;
      if (valueLooksSecret(label, value, separated)) push({ kind: "labelled", text: value, hint: `${label.toLowerCase()}: ${maskSecret(value)}` });
    }
  }

  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    // "pw:Secret1!" glued together is caught above; strip a leading "label:" so the token check sees the value.
    const t = trimToken(raw.replace(/^[^:=：]{1,12}[:=：]/, ""));
    if (isSecretToken(t)) push({ kind: "token", text: t, hint: maskSecret(t) });
  }
  return out;
}

/** Shorthand for `looksLikeSecret(text).length > 0`. */
export function hasSecret(text: string | null | undefined): boolean {
  return looksLikeSecret(text).length > 0;
}

/** The message people and Claude see when a save is refused. Never includes the secret. */
export function secretRefusal(field: string, matches: SecretMatch[]): string {
  const where = matches.slice(0, 3).map((m) => `“${m.hint}”`).join(", ");
  return `Not saved: ${field} looks like it contains a password or login (${where}). Nora HQ never stores credentials — keep them in a password manager (e.g. 1Password or Apple Passwords) and remove them from this text, then try again. If it isn't a password, reword that part.`;
}

/** `text` with every likely password swapped for its masked hint — for showing notes to Claude or in lists. */
export function redactSecrets(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  let out = text;
  for (const m of looksLikeSecret(text)) out = out.split(m.text).join(`[password removed: ${maskSecret(m.text)}]`);
  return out;
}
