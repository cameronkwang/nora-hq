"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addScheduleItemAction, deleteScheduleItemAction, makeDealFromScheduleAction, updateScheduleItemAction } from "@/app/(app)/calendar/schedule-actions";
import { ScheduleSheet } from "./schedule-sheet";
import { Button, buttonClass } from "./ui";
import type { ScheduleEntry } from "./schedule-board";

const monthName = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
};
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * Add (no `item`) or edit one schedule entry. Business, day or "no set day", free, reel. No money.
 * A saved, non-free job can be made into a deal from here; once it has one, this links to it.
 */
export function ScheduleItemForm({ month, item, onDone }: { month: string; item?: ScheduleEntry; onDone: (message?: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState(item?.businessName ?? "");
  const [date, setDate] = useState(item?.date ?? "");
  const [noDay, setNoDay] = useState(item ? !item.date : true);
  const [isFree, setFree] = useState(item?.isFree ?? false);
  const [needsReel, setReel] = useState(item?.needsReel ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const itemMonth = item?.month ?? month;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give the business a name.");
    if (!noDay && !date) return setError("Pick a day, or tick “No set day yet”.");
    setError(null);
    start(async () => {
      const day = noDay ? null : date;
      const r = item
        ? await updateScheduleItemAction(item.id, { businessName: name.trim(), date: day, isFree, needsReel })
        : await addScheduleItemAction({ businessName: name.trim(), date: day, month: day ? day.slice(0, 7) : itemMonth, isFree, needsReel });
      if (!r.ok) return setError(r.error);
      router.refresh();
      onDone(r.message);
    });
  };

  const remove = () =>
    start(async () => {
      if (!item) return;
      const r = await deleteScheduleItemAction(item.id);
      if (!r.ok) return setError(r.error);
      router.refresh();
      onDone(`Removed ${item.businessName}.`);
    });

  const makeDeal = () =>
    start(async () => {
      if (!item) return;
      setError(null);
      const r = await makeDealFromScheduleAction(item.id);
      if (!r.ok) return setError(r.error);
      onDone();
      router.push(`/deals/${r.dealId}${r.created ? "?from=schedule" : ""}`);
    });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="sch-name" className="label">Business</label>
        <input id="sch-name" className="input" value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" maxLength={200} required placeholder="e.g. Crab O’Clock" />
      </div>

      <div>
        <label htmlFor="sch-date" className="label">Day</label>
        <input
          id="sch-date"
          type="date"
          className="input"
          value={noDay ? "" : date}
          min={noDay ? undefined : `${itemMonth}-01`}
          max={noDay ? undefined : lastDay(itemMonth)}
          disabled={noDay}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <label className="mt-1 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={noDay} onChange={(e) => setNoDay(e.currentTarget.checked)} />
          No set day yet — sometime in {monthName(itemMonth)}
        </label>
      </div>

      <div className="flex flex-col">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={isFree} onChange={(e) => setFree(e.currentTarget.checked)} />
          Free
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={needsReel} onChange={(e) => setReel(e.currentTarget.checked)} />
          <span aria-hidden>📸</span> Needs a reel
        </label>
      </div>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending} className="flex-1 sm:flex-none">
          {pending ? "Saving…" : item ? "Save" : "Add to schedule"}
        </Button>
        {item &&
          (confirmDelete ? (
            <span className="flex items-center gap-2">
              <Button type="button" variant="danger" disabled={pending} onClick={remove}>Remove it</Button>
              <button type="button" className="min-h-11 px-2 text-sm text-muted" onClick={() => setConfirmDelete(false)}>Keep</button>
            </span>
          ) : (
            <Button type="button" variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>Remove</Button>
          ))}
      </div>

      {item?.dealId ? (
        <div className="border-t border-border pt-3">
          <Link href={`/deals/${item.dealId}`} className={buttonClass("secondary")}>Open the deal</Link>
          <p className="mt-1 text-xs text-muted">The fee and payment live on the deal. The schedule only shows Paid or Not paid.</p>
        </div>
      ) : item && !item.isFree && !isFree ? (
        <div className="border-t border-border pt-3">
          <Button type="button" variant="secondary" disabled={pending} onClick={makeDeal}>Make it a deal</Button>
          <p className="mt-1 text-xs text-muted">Track the fee, deliverables and payment on a deal. The schedule only shows Paid or Not paid, never an amount.</p>
        </div>
      ) : null}
    </form>
  );
}

/** "+ Add" button in the schedule header → quick form in a sheet. */
export function ScheduleAddButton({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)} aria-haspopup="dialog">
        + Add
      </button>
      <ScheduleSheet open={open} onClose={() => setOpen(false)} title="Add to the schedule" subtitle={`For ${monthName(month)}. Pick a day if there is one.`}>
        <ScheduleItemForm month={month} onDone={() => setOpen(false)} />
      </ScheduleSheet>
    </>
  );
}
