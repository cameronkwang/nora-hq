import Link from "next/link";
import { cx } from "./ui";

export type ScopeOption = { value: string; label: string; href: string };

/**
 * Top-level "Ad hoc · Monthly plan · All" switch on /tasks. Plain links (the URL is the source of truth).
 * Full width with equal segments on phones, compact from sm up.
 */
export function TaskScopeSwitch({ options, current }: { options: ScopeOption[]; current: string }) {
  return (
    <nav aria-label="Which tasks" className="mb-4">
      <div className="grid grid-flow-col auto-cols-fr rounded-lg bg-surface-2 p-1 sm:inline-grid">
        {options.map((o) => {
          const on = o.value === current;
          return (
            <Link
              key={o.value}
              href={o.href}
              aria-current={on ? "page" : undefined}
              className={cx(
                "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition sm:min-h-9 sm:px-4 pointer-coarse:min-h-11",
                on ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
