import { APP_TZ } from "@/lib/dates";

/** Timezone helpers for the calendar. All wall-clock values are in APP_TZ (America/New_York by default). */

function offsetMs(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - (at.getTime() - at.getMilliseconds());
}

/** "2026-11-14" + "18:30" in APP_TZ → the UTC instant. Handles DST transitions. */
export function zonedToUtc(date: string, time = "00:00", tz = APP_TZ): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})/.exec(time || "00:00");
  if (!dm || !tm) return null;
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  const off1 = offsetMs(new Date(guess), tz);
  let ts = guess - off1;
  const off2 = offsetMs(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2;
  return new Date(ts);
}

/** UTC instant → { date: "YYYY-MM-DD", time: "HH:MM" } in APP_TZ. */
export function utcToZoned(d: Date, tz = APP_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

export function timeLabel(d: Date, tz = APP_TZ) {
  return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase();
}

export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday */
export function firstWeekday(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}
