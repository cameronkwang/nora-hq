"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass, cx } from "./ui";

/** "More" overflow on /leads: manual add, import and export stay out of the way of "Find leads". */
export function LeadMenu({ exportHref }: { exportHref: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none md:min-h-9";
  return (
    <div ref={ref} className="relative">
      <button ref={btn} type="button" className={buttonClass("secondary")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        More
        <svg viewBox="0 0 16 16" aria-hidden className={cx("size-3.5 transition", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="More lead actions"
          className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-lg"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
            const i = items.indexOf(document.activeElement as HTMLElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
        >
          <Link href="/leads/new" role="menuitem" className={item} onClick={() => setOpen(false)}>
            Add a lead by hand
          </Link>
          <Link href="/leads/import" role="menuitem" className={item} onClick={() => setOpen(false)}>
            Import CSV
          </Link>
          <a href={exportHref} download role="menuitem" className={item} onClick={() => setOpen(false)}>
            Export CSV
          </a>
        </div>
      )}
    </div>
  );
}
