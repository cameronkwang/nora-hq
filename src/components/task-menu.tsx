"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

export type MenuItem = { label: string; href: string; hint?: string; download?: boolean };

/** Small "⋯" overflow menu for rarely used actions (export, import) so the main screen stays clean. */
export function TaskMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-2 hover:text-text pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="currentColor">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div role="menu" onKeyDown={onMenuKey} className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          {items.map((it) => (
            <a
              key={it.href}
              role="menuitem"
              href={it.href}
              download={it.download || undefined}
              onClick={() => setOpen(false)}
              className={cx("block px-3 py-2.5 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none")}
            >
              {it.label}
              {it.hint && <span className="block text-xs text-muted">{it.hint}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
