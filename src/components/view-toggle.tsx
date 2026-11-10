"use client";

import Link from "next/link";
import { cx } from "./ui";

export type ViewOption = { value: string; label: string; href: string };

/**
 * Segmented List / Board / Table switch. Plain links (the URL is the source of truth);
 * clicking also remembers the choice in a cookie so /tasks opens the same way next time.
 */
export function ViewToggle({ options, current, cookieName, label = "View" }: { options: ViewOption[]; current: string; cookieName: string; label?: string }) {
  const remember = (v: string) => {
    try {
      document.cookie = `${cookieName}=${encodeURIComponent(v)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      /* cookies blocked: the URL still works */
    }
  };
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-1" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === current;
        return (
          <Link
            key={o.value}
            href={o.href}
            onClick={() => remember(o.value)}
            aria-current={on ? "page" : undefined}
            className={cx(
              "inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition pointer-coarse:min-h-11",
              on ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
            )}
          >
            <ViewIcon view={o.value} />
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

function ViewIcon({ view }: { view: string }) {
  const p = { viewBox: "0 0 16 16", "aria-hidden": true, className: "size-4", fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  if (view === "board")
    return (
      <svg {...p}>
        <rect x="1.5" y="2" width="3.5" height="12" rx="1" />
        <rect x="6.25" y="2" width="3.5" height="8" rx="1" />
        <rect x="11" y="2" width="3.5" height="10" rx="1" />
      </svg>
    );
  if (view === "table")
    return (
      <svg {...p}>
        <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
        <path d="M1.5 6h13M1.5 10h13M6 2v12" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M5.5 4h9M5.5 8h9M5.5 12h9" strokeLinecap="round" />
      <circle cx="2.25" cy="4" r=".75" fill="currentColor" />
      <circle cx="2.25" cy="8" r=".75" fill="currentColor" />
      <circle cx="2.25" cy="12" r=".75" fill="currentColor" />
    </svg>
  );
}
