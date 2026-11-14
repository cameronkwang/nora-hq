/**
 * Parses Nora's schedule as she keeps it in her notes app, e.g.
 *
 *   November
 *   9. 11/04 | Antonelli’s - FREE 📸
 *   11. 11/11 | TLJ (DC) - $600.00 () 📸 🚩
 *   20. 11/XX | Charles Chocolates - $250.00 () 📸
 *
 * Keeps only what the app tracks: the date (or "no set day"), the business, FREE and 📸 (a reel to post).
 * Money is never kept: amounts, (Check)/(Zelle), 🚩 and anything after it are dropped — and no output
 * (not even a skipped line) echoes an amount. Pure: no I/O, no server-only imports (used by tests too).
 */

export type ParsedScheduleItem = {
  date: string | null; // "YYYY-MM-DD", or null for "11/XX"
  businessName: string; // as typed (curly quotes kept)
  nameKey: string;
  isFree: boolean;
  needsReel: boolean;
  line: string; // the source line with money scrubbed out
};
export type ParsedScheduleMonth = { month: string; items: ParsedScheduleItem[] };
export type ParsedSchedule = { months: ParsedScheduleMonth[]; skipped: Array<{ line: string; reason: string }> };

const REEL = /\u{1F4F8}/u; // 📸
const FLAG = /\u{1F6A9}/u; // 🚩

/** Lowercase, straight quotes, "&" → "and", punctuation dropped, single spaces. Used to de-dupe re-imports. */
export function scheduleNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const PAY = "(?:check|zelle|cash\\s?app|cash|venmo|paypal|paid|unpaid)";

/**
 * True when text still carries money: "$5", "600.00", 🚩, an amount next to a payment word ("450 (Check)",
 * "paid 500"), or a payment word in brackets. Used as the last guard on business names and notes.
 */
export function looksLikeMoney(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /\$\s*\d|\b\d[\d,]*\.\d{2}\b|\u{1F6A9}/u.test(text) ||
    new RegExp(`\\b\\d[\\d,]*\\s*\\(?\\s*${PAY}\\b|\\b${PAY}\\s*[:\\-–—]?\\s*\\$?\\d|\\(\\s*${PAY}\\s*\\)`, "i").test(text)
  );
}

/** Removes every money-ish bit from a line so it can be shown back safely. */
export function scrubMoney(line: string): string {
  let s = line;
  const flag = s.search(FLAG);
  if (flag >= 0) s = s.slice(0, flag);
  return s
    .replace(/[-–—]?\s*\$\s*[\d,]+(?:\.\d+)?\s*[kK]?/g, "")
    .replace(/[-–—]?\s*\b\d[\d,]*\.\d{2}\b/g, "")
    .replace(new RegExp(`[-–—]?\\s*\\b\\d[\\d,]*(?=\\s*\\(?\\s*${PAY}\\b)`, "gi"), "")
    .replace(new RegExp(`[-–—]?\\s*\\(?\\s*\\b(?:paid|unpaid)\\b\\s*\\)?`, "gi"), "")
    .replace(/\(\s*(check|zelle|cash|venmo|paypal|cashapp|cash app|paid|unpaid)?\s*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const pad = (n: number) => String(n).padStart(2, "0");

function daysIn(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const FULL_MONTHS = "january february march april may june july august september october november december".split(" ");

function monthHeader(line: string): { month: number; year: number | null } | null {
  const m = line.match(/^([a-z]+)\.?(?:\s*,?\s*(\d{4}))?\s*:?\s*$/i);
  if (!m) return null;
  const word = m[1].toLowerCase() === "sept" ? "sep" : m[1].toLowerCase();
  if (word.length < 3) return null;
  const idx = FULL_MONTHS.findIndex((full) => full.startsWith(word));
  if (idx < 0) return null;
  return { month: idx + 1, year: m[2] ? Number(m[2]) : null };
}

/** "Antonelli’s - FREE 📸" → { name: "Antonelli’s", isFree: true }. */
function splitBusiness(rest: string): { name: string; isFree: boolean } {
  let s = rest;
  const flag = s.search(FLAG);
  if (flag >= 0) s = s.slice(0, flag);
  s = s.replace(new RegExp(REEL.source, "gu"), " ").replace(/️/g, "");
  let tail = "";
  // Where the money / payment part starts: " - $600", " $600", " - FREE", " 600.00", " - 450", "450 (Check)",
  // " (Zelle)", " - paid", " paid $500" — the earliest of these wins.
  const cuts = [
    /\s[-–—]\s*(?=\$|free\b)/i,
    /\s(?=\$\s*\d)/,
    /\s[-–—]?\s*(?=\d[\d,]*\.\d{2}\b)/,
    /\s[-–—]\s*(?=\d[\d,]*\s*(?:$|\(|[-–—]))/,
    new RegExp(`\\s[-–—]?\\s*(?=\\d[\\d,]*\\s*\\(?\\s*${PAY}\\b)`, "i"),
    new RegExp(`\\s[-–—]?\\s*(?=\\(\\s*${PAY}?\\s*\\))`, "i"),
    new RegExp(`\\s[-–—]\\s*(?=${PAY}\\b)`, "i"),
    new RegExp(`\\s(?=${PAY}\\s*[-–—:]?\\s*\\$?\\d)`, "i"),
    /\s(?=(?:zelle|venmo|paypal|cash\s?app|paid|unpaid)\s*$)/i, // "Check"/"Cash" alone can be part of a name

  ]
    .map((re) => s.match(re)?.index)
    .filter((i): i is number => i !== undefined);
  if (cuts.length) {
    const at = Math.min(...cuts);
    tail = s.slice(at);
    s = s.slice(0, at);
  }
  const isFree = /\bfree\b/i.test(tail) || /\s[-–—]\s*free\s*$/i.test(s);
  const name = s
    .replace(/\s[-–—]\s*free\s*$/i, "")
    .replace(/\(\s*(check|zelle|cash|venmo|paypal|paid|unpaid)?\s*\)\s*$/i, "")
    .replace(/[\s|–—-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name, isFree };
}

const ITEM = /^(?:\d+\s*[.)]\s*)?(\d{1,2})\s*\/\s*(\d{1,2}|x{1,2}|\?{1,2})(?:\s*\/\s*(\d{2}|\d{4}))?\s*(?:\||[-–—:]|\s)\s*(.*)$/i;

/**
 * Year for a month typed without one. Up to 3 months ahead counts as upcoming (January read in November →
 * next year); anything else is now or the past (December read in February → last year; April read in
 * November → this April).
 */
export function inferYear(mm: number, opts: { today: string; year?: number }): number {
  const thisYear = opts.year ?? Number(opts.today.slice(0, 4));
  const todayMonth = Number(opts.today.slice(5, 7));
  const ahead = (mm - todayMonth + 12) % 12;
  if (ahead >= 1 && ahead <= 3) return mm < todayMonth ? thisYear + 1 : thisYear;
  return mm > todayMonth ? thisYear - 1 : thisYear;
}

/**
 * `today` is "YYYY-MM-DD" in the app timezone. A month without a year is placed by inferYear (or `year`).
 * A business name that still looks like money after cutting is skipped, never stored.
 */
export function parseSchedule(text: string, opts: { today: string; year?: number }): ParsedSchedule {
  const byMonth = new Map<string, ParsedScheduleItem[]>();
  const skipped: ParsedSchedule["skipped"] = [];
  let header: { month: number; year: number | null } | null = null;

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/️/g, "").trim();
    if (!line || !/[a-z0-9]/i.test(line)) continue; // blank or a "---" divider

    const h = monthHeader(line);
    if (h) {
      header = h;
      continue;
    }

    const m = line.match(ITEM);
    if (!m) {
      skipped.push({ line: scrubMoney(line), reason: "No date at the start (like 11/04 or 11/XX)." });
      continue;
    }
    const mm = Number(m[1]);
    if (mm < 1 || mm > 12) {
      skipped.push({ line: scrubMoney(line), reason: `${m[1]} isn't a month.` });
      continue;
    }
    let year: number;
    if (m[3]) year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    else if (header?.year && header.month === mm) year = header.year;
    else year = inferYear(mm, opts);

    let date: string | null = null;
    if (/^\d+$/.test(m[2])) {
      const dd = Number(m[2]);
      if (dd < 1 || dd > daysIn(year, mm)) {
        skipped.push({ line: scrubMoney(line), reason: `${pad(mm)}/${pad(dd)} isn't a real date.` });
        continue;
      }
      date = `${year}-${pad(mm)}-${pad(dd)}`;
    }

    const { name, isFree } = splitBusiness(m[4]);
    const nameKey = scheduleNameKey(name);
    if (!nameKey) {
      skipped.push({ line: scrubMoney(line), reason: "No business name after the date." });
      continue;
    }
    if (looksLikeMoney(name)) {
      skipped.push({ line: scrubMoney(line), reason: "Couldn't separate the business name from the amount — add it on its own line as \"MM/DD | Business\"." });
      continue;
    }
    if (name.length > 200) {
      skipped.push({ line: scrubMoney(line).slice(0, 120), reason: "Business name is too long." });
      continue;
    }

    const month = `${year}-${pad(mm)}`;
    const list = byMonth.get(month) ?? [];
    const item: ParsedScheduleItem = { date, businessName: name, nameKey, isFree, needsReel: REEL.test(line), line: scrubMoney(line) };
    const dup = list.find((x) => x.nameKey === nameKey);
    if (dup) {
      dup.date ??= item.date;
      dup.needsReel ||= item.needsReel;
      dup.isFree ||= item.isFree;
      skipped.push({ line: item.line, reason: `Listed twice in ${month} — merged with the first one.` });
      continue;
    }
    list.push(item);
    byMonth.set(month, list);
  }

  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, items]) => ({ month, items }));
  return { months, skipped };
}

/* ───────────────────────── Matching a name to a business ───────────────────────── */

const STOP = new Set(["the", "and", "of", "llc", "inc", "co"]);
const tokens = (s: string) => scheduleNameKey(s).split(" ").filter((t) => t && !STOP.has(t));
const compact = (s: string) => scheduleNameKey(s).replace(/\s+/g, "");

/**
 * Finds the business a schedule name refers to. "Crab O’Clock" ↔ "Crab O Clock" (same letters);
 * "Massage Kingdom" ↔ "SNF Massage Kingdom" at Richmond (every word of one is in the other).
 * Returns null when nothing — or more than one business equally — matches.
 */
export function matchBusiness<T extends { id: string; name: string; location?: string | null }>(name: string, clients: T[]): T | null {
  const c = compact(name);
  if (!c) return null;
  const exact = clients.filter((x) => compact(x.name) === c || compact(`${x.name} ${x.location ?? ""}`) === c);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const mine = tokens(name);
  const scored: Array<{ client: T; extra: number }> = [];
  for (const x of clients) {
    const theirs = tokens(`${x.name} ${x.location ?? ""}`);
    const nameOnly = tokens(x.name);
    const [small, big] = mine.length <= nameOnly.length ? [mine, theirs] : [nameOnly, mine];
    if (!small.length || small.join("").length < 5) continue; // "NUE" alone is too short to guess from
    if (small.every((t) => big.includes(t))) scored.push({ client: x, extra: Math.abs(big.length - small.length) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => a.extra - b.extra);
  if (scored.length > 1 && scored[0].extra === scored[1].extra) return null;
  return scored[0].client;
}
