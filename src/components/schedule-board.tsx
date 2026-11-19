"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { setReelPostedAction } from "@/app/(app)/calendar/schedule-actions";
import { ScheduleItemForm } from "./schedule-item-form";
import { ScheduleSheet } from "./schedule-sheet";
import { EmptyState, Status, Tag, cx } from "./ui";
import { CHECKLIST_TOTAL } from "@/lib/shoot-checklist";

/**
 * One row of Nora's schedule as the page hands it to the browser. No amount: the table has none. A job that
 * was made into a deal carries the deal's id and whether it's paid; the amount stays on the deal.
 */
export type ScheduleEntry = {
  id: string;
  month: string;
  date: string | null;
  businessName: string;
  clientId: string | null;
  clientName: string | null;
  isFree: boolean;
  needsReel: boolean;
  reelPostedAt: string | null;
  dealId: string | null;
  payment: "paid" | "not_paid" | null;
  /** Shoot-checklist steps ticked (of CHECKLIST_TOTAL). */
  checklistDone: number;
};
export type ScheduleFilter = "all" | "reels" | "free";

const FILTERS: Array<{ value: ScheduleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "reels", label: "Reels to post" },
  { value: "free", label: "Free" },
];

const monthName = (month: string, withYear = false) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
};
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const owesReel = (i: ScheduleEntry) => i.needsReel && !i.reelPostedAt;

/**
 * Schedule tab body: the month switcher and filter chips on one line, then the list grouped by day (the only view
 * on phones), then on desktop the same month as a grid. Undated jobs sit at the top under "Sometime in <Month>".
 * Tapping a name opens the job (its shoot checklist, and links to the business and deal); "Edit" opens the quick form;
 * the 📸 checkbox ticks a reel as posted.
 */
export function ScheduleBoard({
  month,
  items,
  otherReels,
  todayStr,
  initialFilter,
  monthPicker,
}: {
  month: string;
  items: ScheduleEntry[];
  otherReels: ScheduleEntry[];
  todayStr: string;
  initialFilter: ScheduleFilter;
  /** The month switcher, drawn at the start of the filter bar. */
  monthPicker?: ReactNode;
}) {
  const [filter, setFilterState] = useState<ScheduleFilter>(initialFilter);
  const [editing, setEditing] = useState<ScheduleEntry | null>(null);

  const setFilter = (f: ScheduleFilter) => {
    setFilterState(f);
    try {
      const u = new URL(window.location.href);
      if (f === "all") u.searchParams.delete("show");
      else u.searchParams.set("show", f);
      window.history.replaceState(window.history.state, "", u);
    } catch {
      /* URL is a nicety only */
    }
  };

  const keep = (i: ScheduleEntry) => (filter === "reels" ? owesReel(i) : filter === "free" ? i.isFree : true);
  const visible = items.filter(keep);
  const undated = visible.filter((i) => !i.date);
  const dated = visible.filter((i) => i.date).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.businessName.localeCompare(b.businessName)));
  const days = [...new Set(dated.map((i) => i.date!))];
  const counts = { all: items.length, reels: items.filter(owesReel).length, free: items.filter((i) => i.isFree).length };

  return (
    <div>
      <div className="sched-bar">
        {monthPicker}
        <div role="group" aria-label="Show" className="chips">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              <span>
                {f.label} <i>{counts[f.value]}</i>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="sched-list">
        {visible.length === 0 && !(filter === "reels" && otherReels.length) ? (
          <div className="mt-4 border-t border-border">
            <EmptyState title={items.length ? "Nothing matches this filter" : `Nothing on the schedule for ${monthName(month, true)}`}>
              {items.length ? "Try “All”." : "Paste Nora's list or add a job."}
            </EmptyState>
          </div>
        ) : (
          <>
            {undated.length > 0 && (
              <Group title={`Sometime in ${monthName(month)}`}>
                {undated.map((i) => <Row key={i.id} item={i} onEdit={setEditing} />)}
              </Group>
            )}
            {days.map((d) => (
              <Group key={d} title={dayLabel(d)} today={d === todayStr}>
                {dated.filter((i) => i.date === d).map((i) => <Row key={i.id} item={i} onEdit={setEditing} />)}
              </Group>
            ))}
            {filter === "reels" && otherReels.length > 0 && (
              <Group title="Other months">
                {otherReels.map((i) => <Row key={i.id} item={i} onEdit={setEditing} showWhen />)}
              </Group>
            )}
          </>
        )}
      </div>

      {/* Desktop: the same month as a grid, under the list. Each name opens the same quick form as Edit. */}
      <section className="sec hidden md:block" aria-label={`${monthName(month)} at a glance`}>
        <header className="sec-head">
          <h2 className="title">{monthName(month)} at a glance</h2>
        </header>
        <ScheduleGrid month={month} items={dated} todayStr={todayStr} onOpen={setEditing} />
      </section>

      <ScheduleSheet open={!!editing} onClose={() => setEditing(null)} title={editing ? editing.businessName : "Edit"} subtitle="Change the day, free or reel, or remove it.">
        {editing && <ScheduleItemForm month={editing.month} item={editing} onDone={() => setEditing(null)} />}
      </ScheduleSheet>
    </div>
  );
}

/** A day: a caps label on a hairline ("Today" in ink on the right; the page's one red letter is today's numeral in
 *  the month grid), then the visits on hairlines. */
function Group({ title, today, children }: { title: string; today?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={cx("eyebrow group-label", today && "is-today")}>
        {/* Drawn in caps; the words themselves stay in sentence case ("Sometime in November") for screen readers and
            for anything that reads the page's text, which would otherwise get the caps. */}
        <span aria-hidden>{title}</span>
        <span className="sr-only normal-case">{title}</span>
        {today && <b>Today</b>}
      </h3>
      <ul className="list">{children}</ul>
    </section>
  );
}

/** One line per visit: the name (and Free, the deal's Paid / Not paid, the shoot list's progress), the reel checkbox, Edit.
 *  Never an amount. */
function Row({ item, onEdit, showWhen }: { item: ScheduleEntry; onEdit: (i: ScheduleEntry) => void; showWhen?: boolean }) {
  const when = item.date ? dayLabel(item.date) : `Sometime in ${monthName(item.month, true)}`;
  return (
    <li className="row sched-row">
      <span className="row-title">
        {/* The name opens the job: its shoot checklist, plus links to the business and deal. */}
        <Link href={`/calendar/jobs/${item.id}`} className="sched-name tap-target">
          {item.businessName}
        </Link>
        {item.isFree && <Tag>Free</Tag>}
        {item.dealId && <DealStatus item={item} />}
        {showWhen && <span className="meta font-normal">{when}</span>}
        {item.checklistDone > 0 && (
          <span className="meta num font-normal">
            Shoot list {item.checklistDone}/{CHECKLIST_TOTAL}
          </span>
        )}
      </span>
      {item.needsReel && <ReelCheck item={item} />}
      <button type="button" onClick={() => onEdit(item)} className="btn btn-sm btn-ghost" aria-label={`Edit ${item.businessName}`}>
        Edit
      </button>
    </li>
  );
}

/** Payment status of the job's deal: Paid / Not paid, never an amount. Opens the deal. */
function DealStatus({ item }: { item: ScheduleEntry }) {
  const label = item.payment === "paid" ? "Paid" : item.payment === "not_paid" ? "Not paid" : "Deal";
  return (
    <Link href={`/deals/${item.dealId}`} className="sched-deal tap-target font-normal" aria-label={`${label}. Open the ${item.businessName} deal`}>
      <Status tone={item.payment === "paid" ? "ok" : item.payment === "not_paid" ? "warn" : "neutral"} small>
        {label}
      </Status>
    </Link>
  );
}

/** 📸 checkbox: unticked = reel to post; ticked = posted (shows the date). */
function ReelCheck({ item }: { item: ScheduleEntry }) {
  const router = useRouter();
  const [posted, setPosted] = useState(item.reelPostedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (next: boolean) => {
    const prev = posted;
    setPosted(next ? new Date().toISOString() : null);
    setError(null);
    start(async () => {
      const r = await setReelPostedAction(item.id, next);
      if (!r.ok) {
        setPosted(prev);
        setError(r.error);
      } else router.refresh();
    });
  };

  return (
    <label className={cx("reel-check", posted && "is-done", pending && "is-busy")} title={error ?? undefined}>
      <input
        type="checkbox"
        className="check"
        checked={!!posted}
        disabled={pending}
        onChange={(e) => toggle(e.currentTarget.checked)}
        aria-label={posted ? `Reel posted for ${item.businessName}. Untick if not` : `Reel to post for ${item.businessName}. Tick when posted`}
      />
      {posted ? (
        <span>
          <span className="reel-words">Reel posted </span>
          <span className="num">{shortDate(posted)}</span>
        </span>
      ) : (
        <span>
          <span className="emoji" aria-hidden>📸</span>
          <span className="reel-words"> Reel to post</span>
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </label>
  );
}

/** Desktop month grid: each day lists its businesses; 📸 marks a reel still to post. An open grid on hairlines. */
function ScheduleGrid({ month, items, todayStr, onOpen }: { month: string; items: ScheduleEntry[]; todayStr: string; onOpen: (i: ScheduleEntry) => void }) {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<string, ScheduleEntry[]>();
  for (const it of items) byDay.set(it.date!, [...(byDay.get(it.date!) ?? []), it]);

  return (
    <div className="pt-2">
      <div className="mgrid-head eyebrow">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mgrid-body">
        {cells.map((date, i) => {
          const list = date ? (byDay.get(date) ?? []) : [];
          return (
            <div key={date ?? `empty-${i}`} className={cx("mgrid-cell", date === todayStr && "is-today")}>
              {date && (
                <>
                  <div className="mgrid-day">
                    <span>{Number(date.slice(8))}</span>
                  </div>
                  <div className="mgrid-items">
                    {list.slice(0, 4).map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => onOpen(it)}
                        title={`${it.businessName}${it.isFree ? " · Free" : ""}${it.payment === "paid" ? " · Paid" : it.payment === "not_paid" ? " · Not paid" : ""}${owesReel(it) ? " · Reel to post" : it.reelPostedAt ? " · Reel posted" : ""}`}
                        className={cx("mgrid-item", owesReel(it) && "is-owed")}
                      >
                        {owesReel(it) && <span className="emoji" aria-hidden>📸 </span>}
                        {it.businessName}
                      </button>
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
