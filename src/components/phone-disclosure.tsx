"use client";

import { useEffect, useRef } from "react";
import { cx } from "./ui";

/**
 * Collapsed behind a single summary row on phones, always open from md up (where there's room).
 * Keeps the phone screen calm without duplicating the form.
 */
export function PhoneDisclosure({ summary, className, children }: { summary: React.ReactNode; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => { if (mq.matches && ref.current) ref.current.open = true; };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return (
    <details ref={ref} className={cx("group", className)}>
      <summary className="no-marker flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm font-medium text-accent md:hidden">
        <span aria-hidden className="text-lg leading-none transition group-open:rotate-45">+</span>
        {summary}
      </summary>
      <div className="pt-3 md:pt-0">{children}</div>
    </details>
  );
}
