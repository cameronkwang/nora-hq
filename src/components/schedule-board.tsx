"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setReelPostedAction } from "@/app/(app)/calendar/schedule-actions";
import { ScheduleItemForm } from "./schedule-item-form";
import { ScheduleSheet } from "./schedule-sheet";
import { Badge, EmptyState, cx } from "./ui";

/**
 * One row of Nora's schedule as the page hands it to the browser. No money — the table has none. A job that
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
 * Schedule tab body: filter chips, a month grid (desktop) and the list (always; the only view on phones).
 * Undated jobs sit at the top under "Sometime in <Month>". Tapping a name opens its business (if linked);
 * "Edit" opens the quick form; the 📸 checkbox ticks a reel as posted.
 */
export function ScheduleBoard({
  month,
  items,
  otherReels,
  todayStr,
  initialFilter,
}: {
  month: string;
  items: ScheduleEntry[];
  otherReels: ScheduleEntry[];
  todayStr: string;
  initialFilter: ScheduleFilter;
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
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cx(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium pointer-coarse:min-h-11",
              filter === f.value ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-text",
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-80">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="hidden min-w-0 md:block">
          <ScheduleGrid month={month} items={dated} todayStr={todayStr} onOpen={setEditing} />
        </div>

        <div className="min-w-0">
          {visible.length === 0 && !(filter === "reels" && otherReels.length) ? (
            <EmptyState title={items.length ? "Nothing matches this filter" : `Nothing on the schedule for ${monthName(month, true)}`}>
              {items.length ? "Try “All”." : "Paste Nora's list or add a job."}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              {undated.length > 0 && (
                <Group title={`Sometime in ${monthName(month)}`}>
                  {undated.map((i) => <Row key={i.id} item={i} onEdit={setEditing} />)}
                </Group>
              )}
              {days.map((d) => (
                <Group key={d} title={dayLabel(d)} highlight={d === todayStr}>
                  {dated.filter((i) => i.date === d).map((i) => <Row key={i.id} item={i} onEdit={setEditing} hideDate />)}
                </Group>
              ))}
              {filter === "reels" && otherReels.length > 0 && (
                <Group title="Other months">
                  {otherReels.map((i) => <Row key={i.id} item={i} onEdit={setEditing} showMonth />)}
                </Group>
              )}
            </div>
          )}
        </div>
      </div>

      <ScheduleSheet open={!!editing} onClose={() => setEditing(null)} title={editing ? editing.businessName : "Edit"} subtitle="Change the day, free or reel — or remove it.">
        {editing && <ScheduleItemForm month={editing.month} item={editing} onDone={() => setEditing(null)} />}
      </ScheduleSheet>
    </div>
  );
}

function Group({ title, highlight, children }: { title: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={cx("mb-1.5 text-sm font-semibold", highlight && "text-accent")}>
        {title}
        {highlight && " · Today"}
      </h3>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">{children}</ul>
    </section>
  );
}

function Row({ item, onEdit, hideDate, showMonth }: { item: ScheduleEntry; onEdit: (i: ScheduleEntry) => void; hideDate?: boolean; showMonth?: boolean }) {
  const when = item.date ? dayLabel(item.date) : showMonth ? `Sometime in ${monthName(item.month, true)}` : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {item.clientId ? (
            <Link href={`/clients/${item.clientId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline md:min-h-0">
              {item.businessName}
            </Link>
          ) : (
            <span className="text-sm font-medium">{item.businessName}</span>
          )}
          {item.isFree && <Badge tone="ok">Free</Badge>}
          {item.dealId && <DealBadge item={item} />}
        </span>
        {((!hideDate && when) || showMonth) && <span className="block text-xs text-muted">{when}</span>}
      </span>
      {item.needsReel && <ReelCheck item={item} />}
      <button
        type="button"
        onClick={() => onEdit(item)}
        className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-muted hover:bg-surface-2 hover:text-text md:min-h-9"
        aria-label={`Edit ${item.businessName}`}
      >
        Edit
      </button>
    </li>
  );
}

/** Payment status of the job's deal — Paid / Not paid, never an amount. Opens the deal. */
function DealBadge({ item }: { item: ScheduleEntry }) {
  const label = item.payment === "paid" ? "Paid" : item.payment === "not_paid" ? "Not paid" : "Deal";
  return (
    <Link href={`/deals/${item.dealId}`} className="inline-flex min-h-11 items-center md:min-h-0" aria-label={`${label} — open the ${item.businessName} deal`}>
      <Badge tone={item.payment === "paid" ? "ok" : item.payment === "not_paid" ? "warn" : "neutral"}>{label}</Badge>
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
    <label className={cx("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm md:min-h-9", posted ? "text-ok" : "text-warn", pending && "opacity-60")} title={error ?? undefined}>
      <input type="checkbox" checked={!!posted} disabled={pending} onChange={(e) => toggle(e.currentTarget.checked)} aria-label={posted ? `Reel posted for ${item.businessName} — untick if not` : `Reel to post for ${item.businessName} — tick when posted`} />
      {posted ? <span>✓ Reel posted <span className="text-xs text-muted">{shortDate(posted)}</span></span> : <span><span aria-hidden>📸</span> Reel to post</span>}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </label>
  );
}

/** Desktop month grid: each day lists its businesses; 📸 marks a reel still to post. */
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
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-xs font-semibold text-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          const list = date ? (byDay.get(date) ?? []) : [];
          return (
            <div key={date ?? `empty-${i}`} className={cx("min-h-24 min-w-0 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0", !date && "bg-surface-2/40")}>
              {date && (
                <>
                  <span className={cx("mb-1 flex size-6 items-center justify-center rounded-full text-xs", date === todayStr ? "bg-accent font-semibold text-accent-fg" : "text-muted")}>
                    {Number(date.slice(8))}
                  </span>
                  <div className="flex flex-col gap-1">
                    {list.slice(0, 4).map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => onOpen(it)}
                        title={`${it.businessName}${it.isFree ? " · Free" : ""}${it.payment === "paid" ? " · Paid" : it.payment === "not_paid" ? " · Not paid" : ""}${owesReel(it) ? " · Reel to post" : it.reelPostedAt ? " · Reel posted" : ""}`}
                        className={cx(
                          "flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] font-medium",
                          owesReel(it) ? "bg-warn-soft text-warn" : "bg-surface-2 text-text hover:bg-accent-soft",
                        )}
                      >
                        {owesReel(it) && <span aria-hidden>📸</span>}
                        <span className="truncate">{it.businessName}</span>
                      </button>
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
