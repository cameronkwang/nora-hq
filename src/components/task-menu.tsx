"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, cx } from "./ui";

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
        className={cx(buttonClass("ghost", "sm"), "task-menu-btn")}
      >
        <svg viewBox="0 0 16 16" aria-hidden fill="currentColor" stroke="none">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div role="menu" onKeyDown={onMenuKey} className="pop task-menu">
          {items.map((it) => (
            <a
              key={it.href}
              role="menuitem"
              href={it.href}
              download={it.download || undefined}
              onClick={() => setOpen(false)}
            >
              {it.label}
              {it.hint && <span className="meta block">{it.hint}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
