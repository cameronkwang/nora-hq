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

/**
 * Prev / next / pick a month. Keeps every other query param, writes ?month=YYYY-MM.
 * `current` is the real current month (shows a "This month" shortcut when viewing another month).
 */
export function MonthPicker({ month, current }: { month: string; current: string }) {
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-lg border border-border bg-surface">
        <Link href={href(shift(month, -1))} className="rounded-l-lg px-3 py-2 text-sm hover:bg-surface-2" aria-label={`Previous month, ${label(shift(month, -1))}`} scroll={false}>
          ←
        </Link>
        <label className="relative border-x border-border">
          <span className="sr-only">Choose month</span>
          <span aria-hidden className="pointer-events-none block min-w-36 px-3 py-2 text-center text-sm font-semibold">
            {label(month)}
          </span>
          <input
            type="month"
            value={month}
            max={shift(current, 12)}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value)) router.push(href(e.target.value), { scroll: false });
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <Link href={href(shift(month, 1))} className="rounded-r-lg px-3 py-2 text-sm hover:bg-surface-2" aria-label={`Next month, ${label(shift(month, 1))}`} scroll={false}>
          →
        </Link>
      </div>
      {month !== current && (
        <Link href={href(current)} className={cx(buttonClass("ghost", "sm"))} scroll={false}>
          Back to this month
        </Link>
      )}
    </div>
  );
}
