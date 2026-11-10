import { APP_TZ, addMonths } from "../dates";

/** Milliseconds the app timezone is ahead of UTC at instant `t`. */
function tzOffsetMs(t: number): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Local midnight on the 1st of `month` ("YYYY-MM") in APP_TZ, as a UTC Date. */
export function monthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, 1);
  let t = guess - tzOffsetMs(guess);
  t = guess - tzOffsetMs(t); // second pass handles DST boundaries
  return new Date(t);
}

/** [start, end) of a month in APP_TZ. */
export function monthBounds(month: string): { start: Date; end: Date } {
  return { start: monthStart(month), end: monthStart(addMonths(month, 1)) };
}
