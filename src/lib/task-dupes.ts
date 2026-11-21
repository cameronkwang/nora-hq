/**
 * Spotting a task that's already on the list, so Claude doesn't add a second "Post the Golden Wok reel".
 * Two open tasks look the same when they're for the same person and business, are due within 2 days of each
 * other (or neither has a date), start with the same action word and share most of their meaningful words. Dates and numbers in the title are ignored.
 */
const STOP = new Set(["the", "a", "an", "and", "or", "for", "to", "of", "on", "at", "in", "by", "with", "from", "fri", "sat", "sun", "mon", "tue", "wed", "thu"]);

export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w) && !/\d/.test(w)),
  );
}

export function sameWork(a: string, b: string): boolean {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return false;
  // The action has to match too: "Shoot Golden Wok" and "Post Golden Wok reel" are different jobs.
  if ([...x][0] !== [...y][0]) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  // Overlap against the shorter title: "Post Golden Wok reel" is inside the longer one.
  return shared / Math.min(x.size, y.size) >= 0.75 && shared >= 2;
}

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

export function nearDates(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(dayNum(a) - dayNum(b)) <= 2;
}
