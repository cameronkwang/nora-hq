import Link from "next/link";
import { cx, humanize, type Tone } from "./ui";

/**
 * Server-safe month grid (md+) and agenda list (phones) for the content calendar. Ink: an open grid on hairlines,
 * a 7px dot for the post's state, the platform in words.
 */

export type CalendarItem = {
  id: string;
  date: string; // YYYY-MM-DD in app timezone
  time: string; // "6:30pm"
  platform: "instagram" | "tiktok";
  status: string;
  format: string;
  clientName: string;
  caption: string | null;
  mediaCount: number;
};

/** The dot's colour per post state. */
export const STATUS_TONE: Record<string, Tone> = {
  idea: "neutral",
  drafted: "warn",
  approved: "ink", // "Ready": an ink dot, so it can never be mistaken for Failed (danger) in either scheme
  scheduled: "info",
  publishing: "info",
  published: "ok",
  failed: "danger",
};

const statusLabel = (s: string) => (s === "approved" ? "Ready" : humanize(s));
/** The .status modifier for a post state ("is-idle" is the hollow dot). */
const dotCls = (status: string) => {
  const tone = STATUS_TONE[status] ?? "neutral";
  return tone === "neutral" ? "is-idle" : `is-${tone}`;
};
const platformLabel = (p: string) => (p === "instagram" ? "Instagram" : "TikTok");

/** Just the dot (the words are next to it, or in the legend). */
export function StatusDot({ status }: { status: string }) {
  return <span aria-hidden className={cx("status", dotCls(status))} />;
}

export function StatusLegend() {
  return (
    <ul className="cal-legend" aria-label="Status colours">
      {Object.keys(STATUS_TONE)
        .filter((s) => s !== "publishing")
        .map((s) => (
          <li key={s} className={cx("status is-small", dotCls(s))}>
            {statusLabel(s)}
          </li>
        ))}
    </ul>
  );
}

/** One post in a day: the dot and the business, then the time and the platform. */
function Post({ item }: { item: CalendarItem }) {
  return (
    <Link
      href={`/calendar/${item.id}`}
      title={`${item.clientName} · ${platformLabel(item.platform)} ${item.format} · ${statusLabel(item.status)}${item.caption ? `\n${item.caption.slice(0, 140)}` : ""}`}
      className="mgrid-item mgrid-post"
    >
      <span className="l1">
        <StatusDot status={item.status} />
        <span>{item.clientName}</span>
      </span>
      <span className="l2 num">
        {item.time} · {platformLabel(item.platform)}
      </span>
    </Link>
  );
}

export function MonthGrid({ month, items, todayStr, newHref }: { month: string; items: CalendarItem[]; todayStr: string; newHref: (date: string) => string }) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);

  return (
    <div className="mt-3">
      <div className="mgrid-head eyebrow">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mgrid-body">
        {cells.map((date, i) => {
          const list = date ? (byDay.get(date) ?? []) : [];
          return (
            <div key={date ?? `empty-${i}`} className={cx("mgrid-cell min-h-28", date === todayStr && "is-today")}>
              {date && (
                <>
                  <div className="mgrid-day">
                    <span>{Number(date.slice(8))}</span>
                    <Link href={newHref(date)} aria-label={`Add a post on ${date}`} className="mgrid-add">
                      +
                    </Link>
                  </div>
                  <div className="mgrid-items gap-2">
                    {list.slice(0, 4).map((it) => (
                      <Post key={it.id} item={it} />
                    ))}
                    {list.length > 4 && <span className="mgrid-more">+{list.length - 4} more</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Phones: the month as day groups (a caps label on a hairline), one row per post with the time in the margin. */
export function AgendaList({ items, todayStr }: { items: CalendarItem[]; todayStr: string }) {
  const days = [...new Set(items.map((i) => i.date))].sort();
  return (
    <ol>
      {days.map((day) => {
        const d = new Date(`${day}T12:00:00Z`);
        const today = day === todayStr;
        return (
          <li key={day}>
            <h3 className={cx("eyebrow group-label", today && "is-today")}>
              {d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
              {today && <b>Today</b>}
            </h3>
            <ul className="list">
              {items.filter((i) => i.date === day).map((it) => (
                <li key={it.id}>
                  <Link href={`/calendar/${it.id}`} className="cal-post">
                    <span className="time meta num">{it.time}</span>
                    <span className="main">
                      <span className="row-title">{it.clientName}</span>
                      <span className="facts-line meta">
                        <span className={cx("status is-small", dotCls(it.status))}>{statusLabel(it.status)}</span>{" "}
                        <span>
                          {platformLabel(it.platform)} {it.format}
                        </span>{" "}
                        {it.mediaCount > 0 && <span>{it.mediaCount} media</span>}
                      </span>
                      {it.caption && <span className="caption meta">{it.caption}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
