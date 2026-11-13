"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * Controlled bottom sheet (phones) / centered dialog (desktop) on a native <dialog> — focus trap and Esc
 * for free. Same look as the Find leads sheet.
 */
export function ScheduleSheet({
  open,
  onClose,
  title,
  subtitle,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `sheet-${title.replace(/\W+/g, "-").toLowerCase()}`;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx("sheet fixed inset-x-0 top-auto bottom-0 w-full md:inset-0 md:m-auto md:h-fit", wide ? "md:max-w-2xl" : "md:max-w-md")}
    >
      <div className="sheet-panel mx-auto max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-xl md:rounded-2xl md:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="-mr-2 -mt-1 flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-accent">
            Close
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}
