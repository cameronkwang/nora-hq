import Link from "next/link";

export type ScopeOption = { value: string; label: string; href: string };

/**
 * Top-level "Ad hoc · Monthly plan · All" switch on /tasks: underline tabs. Plain links (the URL is the source of truth).
 */
export function TaskScopeSwitch({ options, current }: { options: ScopeOption[]; current: string }) {
  return (
    <nav aria-label="Which tasks" className="tabs">
      {options.map((o) => (
        <Link key={o.value} href={o.href} aria-current={o.value === current ? "page" : undefined}>
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
