"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

type NavClient = { id: string; name: string; location: string | null };

const MAIN = [
  { href: "/", label: "Home" },
  { href: "/asks", label: "Asks", count: "newAsks" as const },
  { href: "/review", label: "Review queue", count: "needsReview" as const },
  { href: "/tasks", label: "Tasks" },
  { href: "/calendar", label: "Content calendar" },
  { href: "/creators", label: "Creators" },
  { href: "/reviews", label: "Google reviews" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ user, clients, counts }: { user: { name: string; email: string }; clients: NavClient[]; counts: { newAsks: number; needsReview: number } }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  const nav = (
    <nav className="flex flex-col gap-6 text-sm">
      <div className="flex flex-col gap-0.5">
        {MAIN.map((item) => {
          const n = item.count ? counts[item.count] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cx("flex items-center justify-between rounded-lg px-3 py-2", active(item.href) ? "bg-accent-soft font-semibold text-accent" : "text-text hover:bg-surface-2")}
            >
              {item.label}
              {n > 0 && <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg">{n}</span>}
            </Link>
          );
        })}
      </div>
      <div>
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Businesses</p>
        <div className="flex flex-col gap-0.5">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              onClick={() => setOpen(false)}
              className={cx("rounded-lg px-3 py-1.5", active(`/clients/${c.id}`) ? "bg-accent-soft font-semibold text-accent" : "hover:bg-surface-2")}
            >
              <span className="block truncate">{c.name}</span>
              {c.location && <span className="block truncate text-xs text-muted">{c.location}</span>}
            </Link>
          ))}
          <Link href="/clients" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-surface-2">
            All businesses / add new
          </Link>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <Link href="/" className="font-semibold">Nora HQ</Link>
        <div className="flex items-center gap-2">
          <Link href="/asks/new" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">+ Ask</Link>
          <button aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-lg border border-border px-3 py-1.5 text-sm">
            Menu
          </button>
        </div>
      </div>
      {open && <div className="border-b border-border bg-surface px-2 py-3 md:hidden">{nav}</div>}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-3 py-5 md:flex">
        <Link href="/" className="mb-5 px-3 text-lg font-semibold tracking-tight">Nora HQ</Link>
        <Link href="/asks/new" className="mb-5 rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-accent-fg hover:opacity-90">+ New ask</Link>
        {nav}
        <div className="mt-auto border-t border-border px-3 pt-4 text-xs text-muted">
          <p className="font-medium text-text">{user.name}</p>
          <p className="truncate">{user.email}</p>
          <form action="/login/logout" method="post" className="mt-2">
            <button className="underline hover:text-text">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
