"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Count, buttonClass, cx } from "./ui";
import { NewClientLink } from "./onboard-link";
import { sectionOf, type SectionKey } from "./section-tabs";

type NavClient = { id: string; name: string; location: string | null; kind?: string | null };
type User = { name: string; email: string };
type Counts = { newAsks: number; needsReview: number; tasksDue: number };
type NavProps = { user: User; creator: NavClient | null; businesses: NavClient[]; inactiveCount: number; counts: Counts };

/** Nora's own workspace handle (clients.kind "creator", seeded as "noraeatsgood"). */
const CREATOR_HANDLE = "noraeatsgood";

type Item = { href: string; label: string; icon?: IconName; section?: SectionKey; badge?: (c: Counts) => number; badgeWord?: string };

/** Everyday places. Inbox, Outreach and Insights are sections: their tabs live at the top of each member page. */
const HOME: Item = { href: "/", label: "Home", icon: "home" };
const INBOX: Item = { href: "/asks", label: "Inbox", icon: "inbox", section: "inbox", badge: (c) => c.newAsks + c.needsReview, badgeWord: "waiting" };
const TASKS: Item = { href: "/tasks", label: "Tasks", icon: "list", badge: (c) => c.tasksDue, badgeWord: "due" };
const CALENDAR: Item = { href: "/calendar", label: "Calendar" };
const OUTREACH: Item = { href: "/creators", label: "Outreach", section: "outreach" };
const INSIGHTS: Item = { href: "/numbers", label: "Insights", section: "insights" };
const SETTINGS: Item = { href: "/settings", label: "Settings" };
const ACTIVITY: Item = { href: "/activity", label: "Activity" };

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

/** A table of contents: text only. The one block of colour is "New ask"; counts are plain cinnabar numerals. */
function DesktopSidebar({ user, creator, businesses, inactiveCount, counts }: NavProps) {
  const active = useIsActive();
  const path = usePathname() ?? "/";

  return (
    <aside className="side">
      <Link href="/" className="wordmark">
        Nora HQ
      </Link>
      <Link href="/asks/new" title="New ask (press N)" className={cx(buttonClass("primary"), "side-new")}>
        <Icon name="plus" />
        New ask <kbd>N</kbd>
      </Link>

      <nav aria-label="Main" className="side-nav">
        <div className="side-group">
          {MAIN.map((item) => (
            <SideLink key={item.href} item={item} active={active(item) && path !== "/asks/new"} count={item.badge?.(counts) ?? 0} />
          ))}
        </div>

        <div className="side-group">
          <p className="eyebrow side-heading">Grow</p>
          {GROW.map((item) => (
            <SideLink key={item.href} item={item} active={active(item)} />
          ))}
        </div>

        <div className="side-group">
          <p className="eyebrow side-heading">
            <Link href="/clients">My businesses</Link>
            <NewClientLink variant="plus" />
          </p>
          {businesses.map((c) => {
            const on = active(`/clients/${c.id}`);
            return (
              <Link key={c.id} href={`/clients/${c.id}`} aria-current={on ? "page" : undefined} className="side-link">
                <span className="t">{c.name}</span>
                {c.location && <span className="place">{c.location}</span>}
              </Link>
            );
          })}
          {businesses.length === 0 && <p className="side-note">No active businesses.</p>}
          {inactiveCount > 0 && (
            <Suspense fallback={<InactiveLink count={inactiveCount} active={false} />}>
              <InactiveLinkWithParams count={inactiveCount} />
            </Suspense>
          )}
        </div>

        {creator && (
          <div className="side-group side-rule">
            <Link href={`/clients/${creator.id}`} aria-current={active(`/clients/${creator.id}`) ? "page" : undefined} className="side-link">
              <span className="t">{creator.name}</span>
              <span className="place">@{CREATOR_HANDLE}</span>
            </Link>
          </div>
        )}
      </nav>

      <div className="side-foot">
        <div className="links">
          <FootLink item={SETTINGS} active={active(SETTINGS)} />
          <span aria-hidden>·</span>
          <FootLink item={ACTIVITY} active={active(ACTIVITY)} />
        </div>
        <div className="user">
          <b title={user.email}>
            {user.name}
            <span className="sr-only"> ({user.email})</span>
          </b>
          <form action="/login/logout" method="post">
            <button>Sign out</button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function FootLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined}>
      {item.label}
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
    <Link href={INACTIVE_HREF} aria-current={active ? "page" : undefined} className="side-link is-quiet">
      Inactive ({count})
      <Icon name="right" width={12} height={12} strokeWidth={2} />
    </Link>
  );
}

function SideLink({ item, active, count = 0 }: { item: Item; active: boolean; count?: number }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className="side-link">
      <span className="t">{item.label}</span>
      {count > 0 && <Count n={count} label={`${count} ${item.badgeWord ?? ""}`.trim()} />}
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
      {/* Top: just the name, on the page. Navigation lives at the bottom, under the thumb. */}
      <header className="topbar">
        <Link href="/" className="wordmark">
          Nora HQ
        </Link>
      </header>

      {/* Bottom tab bar: Home · Inbox · (+) · Tasks · More. Solid paper, a hairline on top. */}
      <nav aria-label="Main" className="tabbar">
        <div className="tabbar-in">
          <Tab item={HOME} active={active(HOME)} count={0} />
          <Tab item={INBOX} active={active(INBOX) && path !== "/asks/new"} count={INBOX.badge!(counts)} />
          <Link href="/asks/new" aria-label="New ask" aria-current={path === "/asks/new" ? "page" : undefined} className="tab tab-new">
            <span>
              <Icon name="plus" />
            </span>
          </Link>
          <Tab item={TASKS} active={active(TASKS)} count={TASKS.badge!(counts)} />
          <button type="button" onClick={show} aria-haspopup="dialog" aria-expanded={open} className={cx("tab", sheetActive && "is-current")}>
            <span className="tab-icon">
              <Icon name="menu" />
            </span>
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
        <div className="sheet-panel more-sheet mx-auto max-h-[85dvh] max-w-md overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="more-head">
            <span aria-hidden className="more-grip" />
            <h2 className="title">More</h2>
            <button type="button" onClick={close} className={buttonClass("ghost")} style={{ color: "var(--text)" }}>
              Done
            </button>
          </div>

          <div className="more-group">
            <div className="more-list">
              {[CALENDAR, ...GROW].map((item) => (
                <SheetLink key={item.href} href={item.href} active={active(item)} onClick={close}>
                  <span className="t">{item.label}</span>
                </SheetLink>
              ))}
            </div>
          </div>

          <div className="more-group">
            <p className="eyebrow">My businesses</p>
            <div className="more-list">
              {businesses.map((c) => (
                <SheetLink key={c.id} href={`/clients/${c.id}`} active={active(`/clients/${c.id}`)} onClick={close}>
                  <span className="t">{c.name}</span>
                  {c.location && <span className="place">{c.location}</span>}
                </SheetLink>
              ))}
              {inactiveCount > 0 && (
                <SheetLink href={INACTIVE_HREF} active={false} onClick={close} quiet>
                  <span className="t">Inactive ({inactiveCount})</span>
                </SheetLink>
              )}
              <NewClientLink variant="row" onClick={close} />
            </div>
          </div>

          {creator && (
            <div className="more-group">
              <div className="more-list">
                <SheetLink href={`/clients/${creator.id}`} active={active(`/clients/${creator.id}`)} onClick={close}>
                  <span className="t">{creator.name}</span>
                  <span className="place">@{CREATOR_HANDLE}</span>
                </SheetLink>
              </div>
            </div>
          )}

          <div className="more-group">
            <div className="more-list">
              {[SETTINGS, ACTIVITY].map((item) => (
                <SheetLink key={item.href} href={item.href} active={active(item)} onClick={close}>
                  <span className="t">{item.label}</span>
                </SheetLink>
              ))}
            </div>
          </div>

          <div className="more-foot">
            <div className="min-w-0">
              <p className="truncate font-medium">{user.name}</p>
              <p className="meta truncate">{user.email}</p>
            </div>
            <form action="/login/logout" method="post">
              <button className={buttonClass("secondary")}>Sign out</button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}

function Tab({ item, active, count }: { item: Item; active: boolean; count: number }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} aria-label={count > 0 ? `${item.label} (${count})` : undefined} className="tab">
      <span className="tab-icon">
        {item.icon && <Icon name={item.icon} />}
        {count > 0 && <span className="tab-badge">{count > 99 ? "99+" : count}</span>}
      </span>
      {item.label}
    </Link>
  );
}

function SheetLink({ href, active, onClick, quiet, children }: { href: string; active: boolean; onClick: () => void; quiet?: boolean; children: ReactNode }) {
  return (
    <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined} className={cx("more-row", quiet && "is-quiet")}>
      {children}
    </Link>
  );
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

/** Line icons for the phone tab bar (the desktop sidebar has none), plus the two small glyphs the lists use. */
type IconName = "home" | "inbox" | "list" | "plus" | "menu" | "right";

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />,
  inbox: <path d="M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6H3v-6z" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  right: <path d="m9 6 6 6-6 6" />,
};

/** Size and stroke width come from the shared CSS (.tab svg, .btn svg) unless given here. */
function Icon({ name, ...rest }: { name: IconName; width?: number; height?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
