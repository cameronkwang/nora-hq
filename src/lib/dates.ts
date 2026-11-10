/** All "month" values are "YYYY-MM" in the app timezone (America/New_York by default). */
export const APP_TZ = process.env.APP_TZ ?? "America/New_York";

function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, day] = f.format(d).split("-");
  return { y: Number(y), m: Number(m), d: Number(day) };
}

export function currentMonth(now = new Date()): string {
  const { y, m } = parts(now);
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function today(now = new Date()): string {
  const { y, m, d } = parts(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive list of the last n months ending at `end`. */
export function lastMonths(n: number, end = currentMonth()): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(end, i - (n - 1)));
}

export function monthLabel(month: string, style: "short" | "long" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", {
    month: style === "long" ? "long" : "short",
    year: style === "long" ? "numeric" : "2-digit",
    timeZone: "UTC",
  });
}

export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

export function formatDate(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d;
  return date.toLocaleString("en-US", {
    timeZone: d instanceof Date || (typeof d === "string" && d.length > 10) ? APP_TZ : "UTC",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function relativeTime(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  const abs = Math.abs(s);
  const fmt = (n: number, u: string) => (s >= 0 ? `${n}${u} ago` : `in ${n}${u}`);
  if (abs < 60) return "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  if (abs < 86400 * 30) return fmt(Math.round(abs / 86400), "d");
  return formatDate(date);
}
