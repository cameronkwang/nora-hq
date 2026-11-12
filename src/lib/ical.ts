/**
 * Minimal RFC 5545 (iCalendar) writer for the private calendar feed.
 *  - CRLF line endings, lines folded at 75 octets (never inside a UTF-8 sequence)
 *  - TEXT values escaped (\\ ; , and newlines)
 *  - timed events in UTC ("Z"), all-day events as VALUE=DATE with an exclusive DTEND
 * Pure functions, no I/O.
 */

export type IcalEvent = {
  uid: string; // stable across fetches
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** Timed event: start instant + duration in minutes. */
  start?: Date;
  minutes?: number;
  /** All-day event: "YYYY-MM-DD". */
  date?: string;
  lastModified?: Date | null;
  categories?: string[];
};

export function escapeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Folds one content line to ≤75 octets per physical line (continuations start with a space). */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // the leading space of a continuation line counts toward its 75 octets
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");

export function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const dateValue = (ymd: string) => ymd.replace(/-/g, "");

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "UID", "SUMMARY" … → folded "NAME:value" line. */
const prop = (name: string, value: string) => foldLine(`${name}:${value}`);

export function buildCalendar(opts: { name: string; description?: string; events: IcalEvent[]; now?: Date }): string {
  const now = opts.now ?? new Date();
  const stamp = utcStamp(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nora HQ//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    prop("X-WR-CALNAME", escapeText(opts.name)),
    ...(opts.description ? [prop("X-WR-CALDESC", escapeText(opts.description))] : []),
    "X-WR-TIMEZONE:America/New_York",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of opts.events) {
    if (!e.start && !e.date) continue;
    lines.push("BEGIN:VEVENT", prop("UID", escapeText(e.uid)), `DTSTAMP:${stamp}`);
    if (e.date) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.date)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(e.date))}`, "TRANSP:TRANSPARENT");
    } else if (e.start) {
      const end = new Date(e.start.getTime() + (e.minutes ?? 60) * 60_000);
      lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(end)}`);
    }
    lines.push(prop("SUMMARY", escapeText(e.summary)));
    if (e.location) lines.push(prop("LOCATION", escapeText(e.location)));
    if (e.description) lines.push(prop("DESCRIPTION", escapeText(e.description)));
    if (e.url) lines.push(prop("URL;VALUE=URI", e.url.replace(/[\r\n]/g, "")));
    if (e.categories?.length) lines.push(prop("CATEGORIES", e.categories.map(escapeText).join(",")));
    if (e.lastModified) lines.push(`LAST-MODIFIED:${utcStamp(e.lastModified)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
