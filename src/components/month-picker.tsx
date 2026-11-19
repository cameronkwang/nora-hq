"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buttonClass, cx } from "./ui";

function shift(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function label(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function Chevron({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/**
 * Prev / next / pick a month. Keeps every other query param, writes ?month=YYYY-MM.
 * `current` is the real current month (shows a "Back to this month" shortcut when viewing another month).
 * Drawn as `.monthpick`: no box, the month in 600 between two quiet arrows. Tapping the month opens the
 * device's own month chooser (an invisible input laid over the words).
 */
export function MonthPicker({ month, current, className }: { month: string; current: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (m: string) => {
    const p = new URLSearchParams(params.toString());
    if (m === current) p.delete("month");
    else p.set("month", m);
    const qs = p.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className={cx("monthpick-wrap", className)}>
      <div className="monthpick" role="group" aria-label="Month">
        <Link href={href(shift(month, -1))} aria-label={`Previous month, ${label(shift(month, -1))}`} scroll={false}>
          <Chevron d="m15 6-6 6 6 6" />
        </Link>
        <label className="m">
          <span className="sr-only">Choose month</span>
          <span aria-hidden>{label(month)}</span>
          <input
            type="month"
            value={month}
            max={shift(current, 12)}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value)) router.push(href(e.target.value), { scroll: false });
            }}
          />
        </label>
        <Link href={href(shift(month, 1))} aria-label={`Next month, ${label(shift(month, 1))}`} scroll={false}>
          <Chevron d="m9 6 6 6-6 6" />
        </Link>
      </div>
      {month !== current && (
        <Link href={href(current)} className={buttonClass("ghost", "sm")} scroll={false}>
          Back to this month
        </Link>
      )}
    </div>
  );
}
