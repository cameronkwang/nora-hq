"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";
import { NewClientLink } from "./onboard-link";
import { sectionOf, type SectionKey } from "./section-tabs";

type NavClient = { id: string; name: string; location: string | null; kind?: string | null };
type User = { name: string; email: string };
type Counts = { newAsks: number; needsReview: number; tasksDue: number };
type NavProps = { user: User; creator: NavClient | null; businesses: NavClient[]; inactiveCount: number; counts: Counts };

/** Nora's own workspace handle (clients.kind "creator", seeded as "noraeatsgood"). */
const CREATOR_HANDLE = "noraeatsgood";

type Item = { href: string; label: string; icon: IconName; section?: SectionKey; badge?: (c: Counts) => number };

/** Everyday places. Inbox, Outreach and Insights are sections: their tabs live at the top of each member page. */
const HOME: Item = { href: "/", label: "Home", icon: "home" };
const INBOX: Item = { href: "/asks", label: "Inbox", icon: "inbox", section: "inbox", badge: (c) => c.newAsks + c.needsReview };
const TASKS: Item = { href: "/tasks", label: "Tasks", icon: "list", badge: (c) => c.tasksDue };
const CALENDAR: Item = { href: "/calendar", label: "Calendar", icon: "calendar" };
const OUTREACH: Item = { href: "/creators", label: "Outreach", icon: "users", section: "outreach" };
const INSIGHTS: Item = { href: "/numbers", label: "Insights", icon: "chart", section: "insights" };
const SETTINGS: Item = { href: "/settings", label: "Settings", icon: "gear" };
const ACTIVITY: Item = { href: "/activity", label: "Activity", icon: "clock" };

const MAIN = [HOME, INBOX, TASKS, CALENDAR];
const GROW = [OUTREACH, INSIGHTS];
const INACTIVE_HREF = "/clients?inactive=1";

function useIsActive() {
  const path = usePathname() ?? "/";
  const section = sectionOf(path);
  return (item: Item | string) => {
    if (typeof item !== "string" && item.section) return section === item.section;
    const href = typeof item === "string" ? item : item.href;
    return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  };
}

export function Sidebar(props: NavProps) {
  useNewAskShortcut();
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileNav {...props} />
    </>
  );
}

/* ------------------------------------------------------------------ desktop */

function DesktopSidebar({ user, creator, businesses, inactiveCount, counts }: NavProps) {
  const active = useIsActive();
  const path = usePathname() ?? "/";

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-3 py-5 md:flex">
      <Link href="/" className="mb-5 px-3 text-lg font-semibold tracking-tight">
        Nora HQ
      </Link>
      <Link
        href="/asks/new"
        title="New ask (press N)"
        className="mb-5 flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
      >
        <Icon name="plus" className="size-4" />
        New ask
        <kbd className="ml-1 rounded border border-current/30 px-1 font-sans text-[10px] font-medium opacity-70">N</kbd>
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-5 text-sm">
        <div className="flex flex-col gap-0.5">
          {MAIN.map((item) => (
            <SideLink key={item.href} item={item} active={active(item) && path !== "/asks/new"} count={item.badge?.(counts) ?? 0} />
          ))}
        </div>

        <div>
          <SideHeading>Grow</SideHeading>
          <div className="flex flex-col gap-0.5">
            {GROW.map((item) => (
              <SideLink key={item.href} item={item} active={active(item)} />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between pr-2">
            <Link href="/clients" className="rounded-md hover:text-text">
              <SideHeading>My businesses</SideHeading>
            </Link>
            <NewClientLink variant="plus" />
          </div>
          <div className="flex flex-col gap-0.5">
            {businesses.map((c) => {
              const on = active(`/clients/${c.id}`);
              return (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  aria-current={on ? "page" : undefined}
                  className={cx("rounded-lg px-3 py-1.5", on ? "bg-accent-soft font-semibold text-accent" : "hover:bg-surface-2")}
                >
                  <span className="block truncate">{c.name}</span>
                  {c.location && <span className="block truncate text-xs font-normal text-muted">{c.location}</span>}
                </Link>
              );
            })}
            {businesses.length === 0 && <p className="px-3 py-1.5 text-xs text-muted">No active businesses.</p>}
            {inactiveCount > 0 && (
              <Suspense fallback={<InactiveLink count={inactiveCount} active={false} />}>
                <InactiveLinkWithParams count={inactiveCount} />
              </Suspense>
            )}
          </div>
        </div>

        {creator && <CreatorCard creator={creator} active={active(`/clients/${creator.id}`)} />}
      </nav>

      <div className="mt-auto pt-6 text-sm">
        <div className="flex gap-1 px-1">
          {[SETTINGS, ACTIVITY].map((item) => {
            const on = active(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cx("flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs", on ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-text")}
              >
                <Icon name={item.icon} className="size-3.5" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-2 border-t border-border px-3 pt-4 text-xs text-muted">
          <p className="font-medium text-text">{user.name}</p>
          <p className="truncate">{user.email}</p>
          <form action="/login/logout" method="post" className="mt-2">
            <button className="underline hover:text-text">Sign out</button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function SideHeading({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{children}</p>;
}

function CreatorCard({ creator, active }: { creator: NavClient; active: boolean }) {
  return (
    <Link
      href={`/clients/${creator.id}`}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2",
        active ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-2",
      )}
    >
      <Icon name="spark" className={cx("size-4 shrink-0", !active && "text-accent")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{creator.name}</span>
        <span className="block truncate text-xs font-normal text-muted">@{CREATOR_HANDLE}</span>
      </span>
    </Link>
  );
}

/** "Inactive (N)" — highlighted on /clients?inactive=1 (the query string needs useSearchParams, hence the Suspense wrapper). */
function InactiveLinkWithParams({ count }: { count: number }) {
  const path = usePathname();
  const params = useSearchParams();
  const on = path === "/clients" && (params?.get("inactive") === "1" || params?.get("archived") === "1");
  return <InactiveLink count={count} active={on} />;
}

function InactiveLink({ count, active }: { count: number; active: boolean }) {
  return (
    <Link
      href={INACTIVE_HREF}
      aria-current={active ? "page" : undefined}
      className={cx("flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs", active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-text")}
    >
      Inactive ({count})
      <Icon name="chevron" className="size-3 rotate-90" />
    </Link>
  );
}

function SideLink({ item, active, count = 0 }: { item: Item; active: boolean; count?: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-lg px-3 py-2",
        active ? "bg-accent-soft font-semibold text-accent" : "text-text hover:bg-surface-2",
      )}
    >
      <Icon name={item.icon} className={cx("size-4 shrink-0", !active && "text-muted")} />
      <span className="flex-1 truncate">{item.label}</span>
      {count > 0 && <CountPill n={count} />}
    </Link>
  );
}

/* ------------------------------------------------------------------- phones */

function MobileNav({ user, creator, businesses, inactiveCount, counts }: NavProps) {
  const active = useIsActive();
  const path = usePathname() ?? "/";
  const sheet = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const show = () => {
    sheet.current?.showModal();
    setOpen(true);
  };
  const close = () => sheet.current?.close();

  // Navigating anywhere closes the sheet.
  useEffect(() => {
    sheet.current?.close();
  }, [path]);

  // iOS doesn't stop the page behind a modal <dialog> from scrolling; do it by hand while open.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  const onTab = [HOME, INBOX, TASKS].some((i) => active(i)) || path === "/asks/new";
  const sheetActive = open || !onTab;

  return (
    <>
      {/* Slim top bar: just the name. Navigation lives at the bottom, under the thumb. */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <div className="flex h-12 items-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <Link href="/" className="font-semibold tracking-tight">
            Nora HQ
          </Link>
        </div>
      </header>

      {/* Bottom tab bar: Home · Inbox · (+) · Tasks · More. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur md:hidden"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          <Tab item={HOME} active={active(HOME)} count={0} />
          <Tab item={INBOX} active={active(INBOX) && path !== "/asks/new"} count={INBOX.badge!(counts)} />
          <Link
            href="/asks/new"
            aria-label="New ask"
            aria-current={path === "/asks/new" ? "page" : undefined}
            className="flex flex-col items-center justify-center"
          >
            <span
              className={cx(
                "flex size-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-md transition active:scale-95",
                path === "/asks/new" && "ring-4 ring-accent-soft",
              )}
            >
              <Icon name="plus" className="size-6" strokeWidth={2.4} />
            </span>
          </Link>
          <Tab item={TASKS} active={active(TASKS)} count={TASKS.badge!(counts)} />
          <button
            type="button"
            onClick={show}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cx("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", sheetActive ? "text-accent" : "text-muted")}
          >
            <Icon name="menu" className="size-6" strokeWidth={sheetActive ? 2.2 : 1.8} />
            More
          </button>
        </div>
      </nav>

      {/* More sheet. Native <dialog>: focus is trapped, Esc closes, the page behind is inert. */}
      <dialog
        ref={sheet}
        aria-label="More"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="sheet fixed inset-x-0 top-auto bottom-0 w-full md:hidden"
      >
        <div className="sheet-panel mx-auto max-h-[85dvh] max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
          <div className="sticky top-0 z-10 flex items-center justify-between bg-surface px-4 pt-2 pb-1">
            <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-border" />
            <h2 className="pt-3 text-base font-semibold">More</h2>
            <button type="button" onClick={close} className="mt-2 flex h-11 items-center rounded-lg px-3 text-sm font-medium text-accent">
              Done
            </button>
          </div>

          <div className="flex flex-col gap-5 px-2 pt-1">
            <SheetGroup>
              {[CALENDAR, ...GROW].map((item) => (
                <SheetLink key={item.href} href={item.href} icon={item.icon} active={active(item)} onClick={close}>
                  {item.label}
                </SheetLink>
              ))}
            </SheetGroup>

            <SheetGroup title="My businesses">
              {businesses.map((c) => (
                <SheetLink key={c.id} href={`/clients/${c.id}`} icon="store" active={active(`/clients/${c.id}`)} onClick={close}>
                  <span className="block truncate">{c.name}</span>
                  {c.location && <span className="block truncate text-xs font-normal text-muted">{c.location}</span>}
                </SheetLink>
              ))}
              {inactiveCount > 0 && (
                <SheetLink href={INACTIVE_HREF} icon="box" active={false} onClick={close}>
                  <span className="text-muted">Inactive ({inactiveCount})</span>
                </SheetLink>
              )}
              <NewClientLink variant="row" onClick={close} />
            </SheetGroup>

            {creator && (
              <SheetGroup>
                <SheetLink href={`/clients/${creator.id}`} icon="spark" active={active(`/clients/${creator.id}`)} onClick={close}>
                  <span className="block truncate">{creator.name}</span>
                  <span className="block truncate text-xs font-normal text-muted">@{CREATOR_HANDLE}</span>
                </SheetLink>
              </SheetGroup>
            )}

            <SheetGroup>
              {[SETTINGS, ACTIVITY].map((item) => (
                <SheetLink key={item.href} href={item.href} icon={item.icon} active={active(item)} onClick={close}>
                  {item.label}
                </SheetLink>
              ))}
            </SheetGroup>

            <div className="flex items-center justify-between gap-3 border-t border-border px-3 pt-4 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
              <form action="/login/logout" method="post">
                <button className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3 font-medium">
                  <Icon name="logout" className="size-4" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

function Tab({ item, active, count }: { item: Item; active: boolean; count: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={count > 0 ? `${item.label} (${count})` : undefined}
      className={cx("flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-accent" : "text-muted")}
    >
      <span className="relative">
        <Icon name={item.icon} className="size-6" strokeWidth={active ? 2.2 : 1.8} />
        {count > 0 && (
          <span className="absolute -right-2.5 -top-1.5 min-w-[1.125rem] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-[1.125rem] text-accent-fg ring-2 ring-surface">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      {item.label}
    </Link>
  );
}

function SheetGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div>
      {title && <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>}
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function SheetLink({ href, icon, active, onClick, children }: { href: string; icon: IconName; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-[15px]",
        active ? "bg-accent-soft font-semibold text-accent" : "active:bg-surface-2",
      )}
    >
      <Icon name={icon} className={cx("size-5 shrink-0", !active && "text-muted")} />
      <span className="min-w-0 flex-1">{children}</span>
    </Link>
  );
}

function CountPill({ n }: { n: number }) {
  return <span className="rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-accent-fg">{n > 99 ? "99+" : n}</span>;
}

/* --------------------------------------------------------------- shortcuts */

/** Press N anywhere (outside a text field) to start a new ask. */
function useNewAskShortcut() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "n" && e.key !== "N") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      if (path === "/asks/new") return;
      e.preventDefault();
      router.push("/asks/new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, path]);
}

/* ------------------------------------------------------------------- icons */

type IconName =
  | "home" | "inbox" | "check" | "list" | "calendar" | "users" | "chart" | "star" | "clock" | "gear"
  | "plus" | "menu" | "chevron" | "store" | "grid" | "logout" | "target" | "trend" | "spark" | "box";

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />,
  inbox: <path d="M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6H3v-6z" />,
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.7 2.7L16.5 9.5" />
    </>
  ),
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  spark: <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5zM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chevron: <path d="m6 15 6-6 6 6" />,
  store: <path d="M4 10v10h16V10M3 10l1.5-6h15L21 10M3 10c0 1.4 1.1 2.5 2.5 2.5S8 11.4 8 10c0 1.4 1.1 2.5 2.5 2.5h3c1.4 0 2.5-1.1 2.5-2.5 0 1.4 1.1 2.5 2.5 2.5S21 11.4 21 10M10 20v-4.5h4V20" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  box: <path d="M3.5 7.5h17v3h-17zM5 10.5V20h14v-9.5M10 14h4" />,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
};

function Icon({ name, className, strokeWidth = 1.8 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {PATHS[name]}
    </svg>
  );
}
