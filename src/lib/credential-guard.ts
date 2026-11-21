/**
 * Spots likely passwords / logins in free text (business notes, brand voice, anything Claude is asked to save, and
 * what an owner types on the public onboarding form or drop page).
 * Nora HQ never stores credentials — they belong in a password manager. Pure and dependency-free, so it runs
 * on the server (ops refuse to save) and in the browser (the Settings notes field warns as you type).
 *
 * Two kinds of match:
 *  - "labelled": a credential label followed by a value — "password: x", "pw hunter2", "pass=…", "login: …", "密码：…".
 *  - "token": one 8+ character word with letters AND digits AND a password-style symbol (!@#$%^&*…), that isn't an
 *    email, URL, @handle, #hashtag, phone number, price, date or opening hours ("Wokstar2020!!", "8112233@Ggg").
 *
 * `looksLikeSecret` is deliberately jumpy: it guards notes the team (or Claude) saves, where a false alarm costs a
 * reword, and `redactSecrets` uses it to mask what Claude and phones read (owner-typed answers included).
 * `looksLikeTypedSecret` is the calmer check for text an owner types on the public forms, where a false alarm stops
 * a busy person from sending. It refuses:
 *  - a label followed by a value shaped like a password ("password: hunter2", "密码是Wokstar2020!!");
 *  - a password label, a colon (or "is", 是) and ONE word that ends the line, whatever it looks like
 *    ("ig password: goldenwok", "ig password is goldenwok", "密码：woaini") — but not someone talking
 *    ("password: can you help", "the password is wrong", "Password: Google");
 *  - in the deal / anything-else boxes and the drop note (`tokens: false`, where a bare "Buy1Get1!" is fine): a
 *    password-shaped word right after a user name ("login: name / Wokstar2020!!", "账号 name Wokstar2020!!",
 *    "name@mail.com Wokstar2020!!", "IG: name / Wok2020!"), right after "pass" or a platform's account ("pass
 *    Wok2020!", "IG account: Wok2020!"), or anywhere after the word "password" on the same line ("the password to
 *    our IG is Wokstar2020!!"). A deal that mentions an account or a slash is still a deal ("Loyalty account:
 *    buy10get1!", "会员账户每周二 Buy1Get1!", "BOGO / Buy1Get1!").
 *
 * Full-width characters from a Chinese keyboard ("密码：１２３４５６") are read as their plain forms, and Chinese
 * right after a label is someone talking, never the password ("密码怎么办"); the password is the part before it.
 *
 * Callers must never echo `text` back to people or Claude — show `hint` (masked) instead.
 */

/** The warning shown on a business page / Settings when its notes look like they hold a password. */
export const PASSWORD_WARNING = "This business's notes look like they contain a password. Remove it and use a password manager.";

export type SecretMatch = {
  kind: "labelled" | "token";
  /** The raw matched value. Internal only — never display or log it. */
  text: string;
  /** Safe to show: the label (if any) plus a masked value, e.g. "password: W•••••••!". */
  hint: string;
};

/** Labels that mean "a password follows", even without a colon ("pw hunter2", "password is x"). */
const STRONG = "passwords|password|passwd|passcode|pwd|pw|密码|密碼|口令";
/** Labels that only count with a separator ("pass=x", "login: x"). */
const WEAK = "pass|login|log-in|signin|sign-in|账号密码|帳號密碼";

const STRONG_RE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${STRONG})(\\s*[:=：]\\s*|\\s*-\\s+|\\s+(?:(?:is|was)(?:\\s*[:=：]\\s*|\\s+))?)([^\\s,;]+)`, "giu");
/** Chinese labels need no word boundary ("店的密码：…", "密码是…"). */
const CJK_RE = /(账号密码|帳號密碼|密码|密碼|口令)(\s*(?:[:=：]|是|为|為)?\s*)([^\s,;，。、]+)/gu;
const WEAK_RE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${WEAK})(\\s*[:=：]\\s*)([^\\s,;]+)`, "giu");
/** Labels that can only mean a password ("pass" may be a lunch pass, "login" a username). */
const PASSWORD_LABEL = new RegExp(`^(?:${STRONG}|账号密码|帳號密碼)$`, "i");
/** Words that say an account follows: the next word or two may be its password ("login: name / Wokstar2020!!"). */
const CUE_RE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(${STRONG}|${WEAK}|log\\s?in|sign\\s?in|user\\s?name|user\\s?id|account|acct)(?![\\p{L}\\p{N}])|(账号|帐号|帳號|账户|帐户|帳戶|用户名|用戶名|登录|登錄|登入|密码|密碼|口令)`,
  "giu",
);
/** An email inside a line, and "name /": what follows may be the password. */
const EMAIL_IN_LINE = /[^\s@/:=]+@[^\s@/]+\.[a-z]{2,}/gi;
const NAME_SLASH = /(?:^|[\s:=])[A-Za-z0-9._@+-]{3,}\s*\/(?!\/)/g;
/** "name /" only counts on a line about an account ("IG: goldenwok / …"), not in a deal ("BOGO / Buy1Get1!"). */
const ACCOUNT_WORD =
  /(?:^|[^\p{L}\p{N}])(?:ig|insta(?:gram)?|fb|facebook|tik\s?tok|tt|gmail|e-?mail|log\s?in|sign\s?in|user\s?name|user\s?id|account|acct|wechat)(?![\p{L}\p{N}])|账号|帐号|帳號|账户|帐户|帳戶|用户名|用戶名|登录|登錄|登入|微信/iu;
/** A word that reads as a user name ("goldenwok", "是pokeplace", "name@mail.com"): after an account word, the next word may be its password. */
const USERNAME = /^(?:是|为|為)?[A-Za-z0-9._@+-]{3,}[,.;:]?$/;

/** Words that follow "password" in ordinary sentences ("password manager", "password reset"). */
const NOT_A_VALUE = new Set([
  "manager", "managers", "reset", "resets", "change", "changed", "protected", "required", "needed", "later", "less",
  "in", "on", "at", "the", "a", "an", "for", "to", "with", "and", "or", "of", "from", "into", "via", "by",
  "none", "n/a", "na", "tbd", "tba", "unknown", "?", "-", "—", "ask", "see", "here", "there", "it", "them", "this", "that",
  "please", "never", "not", "no", "yes", "sent", "shared", "saved", "stored", "1password", "lastpass", "bitwarden", "keychain",
  "owner", "client", "nora", "cameron", "we", "they", "you", "he", "she", "manager.", "managers.", "hint", "hints",
  "forgot", "forgotten", "lost", "same", "idk", "unsure", "help",
  // How a sentence goes on after "password:" ("password: can you help"). All too short to be a real password.
  "can", "could", "how", "what", "why", "when", "where", "is", "are", "was", "do", "does", "did", "will", "would",
  "i", "my", "our", "your", "if", "but", "so", "sorry", "thank", "get",
  // What "my password is …" says when it isn't the password ("the password is wrong", "… what my password is anymore").
  "wrong", "incorrect", "expired", "required", "locked", "blocked", "hacked", "fine", "ok", "okay", "correct", "right",
  "old", "new", "weak", "strong", "anymore", "now", "too", "again", "gone", "missing",
]);
/**
 * Single words that answer "password:" without being one ("Password: Google" = I sign in with Google, "password:
 * thanks"). Only the calm form check skips them; what Claude reads still has them masked.
 */
const LONE_TALK = new Set(["thanks", "thx", "sure", "pending", "resetting", "dunno", "google", "gmail", "email", "wechat", "text", "call", "soon"]);

const PASSWORD_SYMBOL = /[!@#$%^&*?~+=<>{}[\]|\\]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)|^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]\S*)?$/i;
/** Words that make a token a time/date/quantity rather than a secret once removed ("11am–9pm", "Mon–Fri", "3x/week"). */
const BENIGN_WORDS = /(am|pm|st|nd|rd|th|k|x|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|min|mins|hr|hrs|h|lb|lbs|oz|ft|pcs|pc|off|ea|each|week|wk|mo|yr|day|days|per)/gi;

/** "Wokstar2020!!" → "W•••••••!" — enough to recognise, not enough to use. */
export function maskSecret(v: string): string {
  const s = [...v];
  if (s.length <= 2) return "•".repeat(s.length);
  return `${s[0]}${"•".repeat(Math.min(8, s.length - 2))}${s[s.length - 1]}`;
}

/** Trims wrapping punctuation people put around words: quotes, brackets, trailing full stops/commas. */
function trimToken(t: string): string {
  return t.replace(/^[("'“‘[<]+/, "").replace(/[)"'”’\]>,.;:。，、]+$/, "");
}

/** An @handle, #hashtag, /path, email, link, price or percentage: never a password. */
function plainlyNotSecret(t: string): boolean {
  if (/^[@#/]/.test(t)) return true;
  if (EMAIL.test(t) || URLISH.test(t) || t.includes("://")) return true;
  return /^[$€£¥]|^[A-Z]{3}\$|^\d[\d,.]*%/.test(t);
}

/** True for a standalone word that looks like a password (see file comment). */
export function isSecretToken(raw: string): boolean {
  const t = trimToken(raw);
  if ([...t].length < 8 || /\s/.test(t)) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t) || !PASSWORD_SYMBOL.test(t)) return false;
  if (plainlyNotSecret(t)) return false;
  // Dates / times / quantities: nothing letter-like left once the usual unit words are gone.
  if (!/[A-Za-z]/.test(t.replace(BENIGN_WORDS, ""))) return false;
  return true;
}

/** Sentence punctuation after a word ("what is the password for?"). */
const SENTENCE_END = /[?!.…]+$/u;
/** Anything that reads as a new line. */
const LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/;
const LINE = /[^\n\r\v\f\u0085\u2028\u2029]+/g;

function valueLooksSecret(label: string, value: string, separated: boolean): boolean {
  const v = trimToken(value);
  const core = v.replace(SENTENCE_END, "");
  if (!core || NOT_A_VALUE.has(core.toLowerCase()) || NOT_A_VALUE.has(v.toLowerCase())) return false;
  if (/^[$€£¥]\d[\d,.]*$/.test(v)) return false; // a plain price: "Lunch pass: $50 a month"
  if (EMAIL.test(v) && /^(login|log-in|signin|sign-in)$/i.test(label)) return true; // "login: owner@x.com" — a login, still not for here
  if (separated) return [...v].length >= 3;
  // No colon ("pw hunter2", "password is Wokstar2020"): the value has to look like one.
  return [...v].length >= 4 && (/\d/.test(v) || PASSWORD_SYMBOL.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)));
}

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const CJK_CHAR = new RegExp(`[${CJK}]`, "u");
/** A stretch with no Chinese in it. Chinese has no spaces ("密码是Wokstar2020!!谢谢" is one word): a password is such a stretch. */
const LATIN_RUN = new RegExp(`[^${CJK}]+`, "gu");

/**
 * Full-width letters, digits and punctuation from a Chinese keyboard ("密码：１２３４５６") in their plain forms (NFKC).
 * One character for one, so a position in the result is the same position in the text as typed.
 */
const foldWidth = (s: string) => s.replace(/[\u3000\uFF01-\uFF5E]/g, (c) => c.normalize("NFKC"));

/**
 * The calmer rule for owner-typed text: after a label, only a value shaped like a password counts — a digit, a
 * symbol or a capital inside the word ("Wokstar2020!!", "hunter2", "sunShine"). Ordinary words ("password: can you
 * help"), handles, emails, links and prices don't. `glued` = Chinese follows straight on, where a capital inside
 * the word is usually a brand ("密码是iPhone自动保存的").
 */
function typedValueLooksSecret(value: string, separated: boolean, glued: boolean): boolean {
  const core = value.replace(SENTENCE_END, "");
  if (!core || NOT_A_VALUE.has(core.toLowerCase()) || plainlyNotSecret(value)) return false;
  if ([...core].length < (separated ? 3 : 4)) return false;
  return /\d/.test(core) || PASSWORD_SYMBOL.test(core) || (!glued && /[a-z]/.test(core) && /[A-Z]/.test(core.slice(1)));
}

/**
 * "ig password: goldenwok", "ig password is goldenwok", "密码：woaini": after a password label and a colon (or "is",
 * 是), ONE word that ends the line is the password, whatever it looks like. More words after it ("password: can you
 * help", "password: same as Facebook") is someone talking, and is left to the shape rule above; so is a word that
 * says what the password is like ("the password is wrong"). `end` is where the word ends in `src`.
 */
function loneWordAfterPasswordLabel(src: string, end: number, label: string, gap: string, value: string): boolean {
  if (!PASSWORD_LABEL.test(label) || !(/[:=是为為]/.test(gap) || /^\s+(?:is|was)\s+$/i.test(gap)) || LINE_BREAK.test(gap)) return false;
  if (!/^[\s)"'”’\]>,.;:!?。、…]*$/u.test(src.slice(end).split(LINE_BREAK, 1)[0])) return false;
  const core = value.replace(SENTENCE_END, "");
  return [...core].length >= 3 && !NOT_A_VALUE.has(core.toLowerCase()) && !plainlyNotSecret(value);
}

function scan(text: string | null | undefined, mode: { typed: boolean; tokens: boolean }): SecretMatch[] {
  if (!text || !text.trim()) return [];
  const src = foldWidth(text);
  const out: SecretMatch[] = [];
  const seen = new Set<string>();
  /** `at` is a position in `src`, which lines up with `text`: a match always carries the words as typed. */
  const push = (kind: SecretMatch["kind"], at: number, length: number, label?: string) => {
    const value = text.slice(at, at + length);
    if (seen.has(value)) return;
    seen.add(value);
    out.push({ kind, text: value, hint: label ? `${label.toLowerCase()}: ${maskSecret(value)}` : maskSecret(value) });
  };
  /** Every password-shaped stretch of one word (a word of Chinese text can hold several stretches). */
  const pushTokens = (word: string, at: number) => {
    // A link, email, @handle or #hashtag stays one word, Chinese inside or not ("…/照片?rlkey=x7Yz1&dl=0", "#金龙Wok2020!").
    if (plainlyNotSecret(trimToken(word))) return;
    for (const r of word.matchAll(LATIN_RUN)) {
      const t = trimToken(r[0]);
      if (isSecretToken(t)) push("token", at + r.index + r[0].indexOf(t), t.length);
    }
  };

  for (const re of [STRONG_RE, WEAK_RE, CJK_RE]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const [, label, gap, raw] = m;
      const end = m.index + m[0].length;
      // Chinese right after the label is someone talking ("密码怎么办"); a password is the part before any Chinese.
      const cjkAt = raw.search(CJK_CHAR);
      const run = cjkAt < 0 ? raw : raw.slice(0, cjkAt);
      if (cjkAt >= 0 && !mode.typed) {
        // The jumpy check also takes numbers further into the sentence ("密码是我的生日19850505").
        for (const r of raw.slice(cjkAt).matchAll(LATIN_RUN)) {
          const t = trimToken(r[0]);
          if ([...t].length >= 4 && /\d/.test(t) && !plainlyNotSecret(t)) push("labelled", end - raw.length + cjkAt + r.index + r[0].indexOf(t), t.length, label);
        }
      }
      const value = trimToken(run);
      if (!value) continue;
      const sep = /[:=：是为為-]/.test(gap);
      const lone = cjkAt < 0 && loneWordAfterPasswordLabel(src, end, label, gap, value);
      const hit = mode.typed
        ? typedValueLooksSecret(value, sep, cjkAt >= 0) || (lone && !LONE_TALK.has(value.replace(SENTENCE_END, "").toLowerCase()))
        : valueLooksSecret(label, value, sep || re === CJK_RE) || lone;
      if (hit) push("labelled", end - raw.length + run.indexOf(value), value.length, label);
    }
  }

  if (mode.tokens) {
    for (const w of src.matchAll(/\S+/g)) {
      // "pw:Secret1!" glued together is caught above; skip a leading "label:" so the token check sees the value.
      const skip = /^[^:=]{1,12}[:=]/.exec(w[0])?.[0].length ?? 0;
      pushTokens(w[0].slice(skip), w.index + skip);
    }
    return out;
  }
  if (!mode.typed) return out;

  // The prose boxes: a bare "Buy1Get1!" is fine, but not a password-shaped word right after an account.
  for (const l of src.matchAll(LINE)) {
    const line = l[0];
    const next = /[\s:=/|,;\-–—]*([^\s/]+)/y;
    /** Checks the next `count` words after `from` ("/", ":", "-" between them don't count as words). */
    const after = (from: number, count: number) => {
      next.lastIndex = from;
      for (let i = 0; i < count; i++) {
        const w = next.exec(line);
        if (!w) return;
        pushTokens(w[1], l.index + next.lastIndex - w[1].length);
      }
    };
    /**
     * After an account word: the word right after "pass" or after a platform's account ("pass Wok2020!", "IG account:
     * Wok2020!"), and the word after a user name ("login goldenwok Wok2020!"). A deal is left alone: "Loyalty account:
     * buy10get1!" and "会员账户每周二 Buy1Get1!" name no platform and no user name.
     */
    const afterAccount = (from: number, cue: "pass" | "platform" | "account") => {
      next.lastIndex = from;
      const w1 = next.exec(line);
      // "log in to get…", "an account and…": someone talking about an account, not giving one.
      if (!w1 || NOT_A_VALUE.has(trimToken(w1[1]).toLowerCase())) return;
      if (cue !== "account") pushTokens(w1[1], l.index + next.lastIndex - w1[1].length);
      if (cue === "pass" || !USERNAME.test(w1[1])) return;
      const w2 = next.exec(line);
      if (w2) pushTokens(w2[1], l.index + next.lastIndex - w2[1].length);
    };
    for (const c of line.matchAll(CUE_RE)) {
      const cue = c[1] ?? c[2];
      // After the word "password" itself, anywhere further on the line ("the password to our IG is Wokstar2020!!").
      if (PASSWORD_LABEL.test(cue)) after(c.index + c[0].length, Infinity);
      else afterAccount(c.index + c[0].length, /^pass$/i.test(cue) ? "pass" : ACCOUNT_WORD.test(line.slice(0, c.index)) ? "platform" : "account");
    }
    for (const e of line.matchAll(EMAIL_IN_LINE)) after(e.index + e[0].length, 1);
    for (const n of line.matchAll(NAME_SLASH)) {
      if (ACCOUNT_WORD.test(line.slice(0, n.index + n[0].length))) after(n.index + n[0].length, 1);
    }
  }
  return out;
}

/** Every likely password/login in `text` (empty when clean). Never show `text` of a match — use `hint`. */
export function looksLikeSecret(text: string | null | undefined): SecretMatch[] {
  return scan(text, { typed: false, tokens: true });
}

/**
 * The same for text an owner typed on a public form (see file comment). `tokens: false` also skips the bare-word
 * rule, for boxes where deal text like "Buy1Get1!" or "2for$10!" is exactly what we ask for. Only for refusing a
 * form: what Claude and phones read goes through `redactSecrets` (the jumpy check) as well.
 */
export function looksLikeTypedSecret(text: string | null | undefined, opts: { tokens?: boolean } = {}): SecretMatch[] {
  return scan(text, { typed: true, tokens: opts.tokens ?? true });
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

/**
 * `text` with every likely password swapped for its masked hint — for what Claude and phones read: notes, and
 * anything an owner typed on a public form. Jumpy on purpose, so it also masks a deal written as one word
 * ("Buy1Get1!"): never use it to refuse a form, and keep the text as typed for the team's own pages.
 */
export function redactSecrets(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  let out = text;
  for (const m of looksLikeSecret(text)) out = out.split(m.text).join(`[password removed: ${maskSecret(m.text)}]`);
  return out;
}

/**
 * An ask's text for everywhere but its own page: Claude, a push, the task it becomes. Text that came in through a
 * public form (createdBy "public": the collab form, the onboarding form's asks, an owner drop) goes through
 * redactSecrets; the team's own asks come back as written.
 */
export function publicAskText(a: { body: string; createdBy?: string | null; dropLinkId?: string | null }): string {
  return a.createdBy === "public" || a.dropLinkId ? (redactSecrets(a.body) ?? "") : a.body;
}
