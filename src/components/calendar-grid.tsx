import Link from "next/link";
import { cx, humanize } from "./ui";

/** Server-safe month grid (md+) and agenda list (mobile) for the content calendar. */

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

export const STATUS_DOT: Record<string, string> = {
  idea: "bg-muted",
  drafted: "bg-warn",
  approved: "bg-accent",
  scheduled: "bg-info",
  publishing: "bg-info",
  published: "bg-ok",
  failed: "bg-danger",
};

export function StatusDot({ status }: { status: string }) {
  return <span aria-hidden className={cx("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status] ?? "bg-muted")} />;
}

export function StatusLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Status colours">
      {Object.keys(STATUS_DOT).filter((s) => s !== "publishing").map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <StatusDot status={s} /> {s === "approved" ? "Ready" : humanize(s)}
        </li>
      ))}
      <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-0.5 bg-ig" /> Instagram</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-0.5 bg-tt" /> TikTok</li>
    </ul>
  );
}

function Chip({ item }: { item: CalendarItem }) {
  return (
    <Link
      href={`/calendar/${item.id}`}
      title={`${item.clientName} · ${item.platform === "instagram" ? "Instagram" : "TikTok"} ${item.format} · ${humanize(item.status)}${item.caption ? `\n${item.caption.slice(0, 140)}` : ""}`}
      className={cx(
        "flex items-center gap-1 truncate rounded border-l-2 bg-surface-2 px-1.5 py-0.5 text-[11px] leading-tight hover:bg-accent-soft",
        item.platform === "instagram" ? "border-ig" : "border-tt",
      )}
    >
      <StatusDot status={item.status} />
      <span className="shrink-0 tabular-nums text-muted">{item.time}</span>
      <span className="truncate font-medium">{item.clientName}</span>
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
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-xs font-semibold text-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          const list = date ? (byDay.get(date) ?? []) : [];
          const isToday = date === todayStr;
          return (
            <div key={date ?? `empty-${i}`} className={cx("group min-h-28 min-w-0 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0", !date && "bg-surface-2/40")}>
              {date && (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cx("flex size-6 items-center justify-center rounded-full text-xs", isToday ? "bg-accent font-semibold text-accent-fg" : "text-muted")}>
                      {Number(date.slice(8))}
                    </span>
                    <Link href={newHref(date)} aria-label={`Add a post on ${date}`} className="rounded px-1 text-sm text-muted opacity-0 hover:bg-surface-2 hover:text-text focus:opacity-100 group-hover:opacity-100">
                      +
                    </Link>
                  </div>
                  <div className="flex flex-col gap-1">
                    {list.slice(0, 4).map((it) => (
                      <Chip key={it.id} item={it} />
                    ))}
                    {list.length > 4 && <span className="px-1 text-[11px] text-muted">+{list.length - 4} more</span>}
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

export function AgendaList({ items, todayStr }: { items: CalendarItem[]; todayStr: string }) {
  const days = [...new Set(items.map((i) => i.date))].sort();
  return (
    <ol className="flex flex-col gap-4">
      {days.map((day) => {
        const d = new Date(`${day}T12:00:00Z`);
        return (
          <li key={day}>
            <h3 className={cx("mb-1.5 text-sm font-semibold", day === todayStr && "text-accent")}>
              {d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
              {day === todayStr && " · Today"}
            </h3>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {items.filter((i) => i.date === day).map((it) => (
                <li key={it.id}>
                  <Link href={`/calendar/${it.id}`} className={cx("flex gap-3 border-l-4 px-3 py-2.5 hover:bg-surface-2", it.platform === "instagram" ? "border-ig" : "border-tt")}>
                    <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted">{it.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{it.clientName}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <StatusDot status={it.status} /> {it.status === "approved" ? "Ready" : humanize(it.status)} · {it.platform === "instagram" ? "Instagram" : "TikTok"} {it.format}
                        {it.mediaCount > 0 && ` · ${it.mediaCount} media`}
                      </span>
                      {it.caption && <span className="mt-0.5 line-clamp-2 block break-words text-xs text-muted">{it.caption}</span>}
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
