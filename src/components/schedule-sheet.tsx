"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { buttonClass, cx } from "./ui";

/**
 * Controlled bottom sheet (phones) / centered dialog (desktop) on a native <dialog>: focus trap and Esc
 * for free. A raised surface (14px radius, the one floating shadow), the title in the serif.
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
      className={cx("sheet sched-sheet fixed inset-x-0 top-auto bottom-0 w-full md:inset-0 md:m-auto md:h-fit", wide ? "md:max-w-2xl" : "md:max-w-md")}
    >
      <div className="sheet-panel mx-auto max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:rounded-xl md:p-6">
        <div className="sheet-head">
          <div className="min-w-0">
            <h2 id={titleId} className="title break-words">{title}</h2>
            {subtitle && <p className="meta mt-1">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className={cx(buttonClass("ghost"), "shrink-0 text-text")}>
            Close
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}
