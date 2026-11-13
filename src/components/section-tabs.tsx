"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cx } from "./ui";

/**
 * Sections group several existing pages under one sidebar entry. Every page keeps its own URL;
 * the layout renders these tabs at the top of each member page so you can hop between them.
 */
export type SectionKey = "inbox" | "outreach" | "insights";
type CountKey = "newAsks" | "needsReview";
type SectionTab = { key: string; label: string; href: string; path: string; count?: CountKey };

export const SECTIONS: Record<SectionKey, { label: string; tabs: SectionTab[] }> = {
  inbox: {
    label: "Inbox",
    tabs: [
      { key: "todo", label: "To do", href: "/asks", path: "/asks", count: "newAsks" },
      { key: "approve", label: "To approve", href: "/review", path: "/review", count: "needsReview" },
      { key: "ideas", label: "Ideas", href: "/asks?tab=ideas", path: "/asks" },
      { key: "done", label: "Done", href: "/asks?tab=done", path: "/asks" },
    ],
  },
  outreach: {
    label: "Outreach",
    tabs: [
      { key: "creators", label: "Creators", href: "/creators", path: "/creators" },
      { key: "leads", label: "Leads", href: "/leads", path: "/leads" },
      { key: "collabs", label: "Collab requests", href: "/collabs", path: "/collabs" },
    ],
  },
  insights: {
    label: "Insights",
    tabs: [
      { key: "numbers", label: "Numbers", href: "/numbers", path: "/numbers" },
      { key: "reports", label: "Reports", href: "/reports", path: "/reports" },
      { key: "stats", label: "My stats", href: "/stats", path: "/stats" },
      { key: "reviews", label: "Google reviews", href: "/reviews", path: "/reviews" },
    ],
  },
};

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Which section a path belongs to (detail pages included) — drives the sidebar's active state. */
export function sectionOf(path: string): SectionKey | null {
  if (under(path, "/inbox")) return "inbox";
  if (under(path, "/outreach")) return "outreach";
  if (under(path, "/insights")) return "insights";
  for (const key of Object.keys(SECTIONS) as SectionKey[]) {
    if (SECTIONS[key].tabs.some((t) => under(path, t.path))) return key;
  }
  return null;
}

/** The tab to highlight on a section's list page, or null when the path isn't one (detail pages, /asks/new…). */
function activeTab(path: string, tab: string): { section: SectionKey; key: string } | null {
  const section = (Object.keys(SECTIONS) as SectionKey[]).find((k) => SECTIONS[k].tabs.some((t) => t.path === path));
  if (!section) return null;
  if (path === "/asks") {
    // /asks keeps its own sub-tabs (Inbox, For Nora, For Cameron…); those all count as "To do".
    const key = tab === "ideas" ? "ideas" : tab === "done" || tab === "archived" ? "done" : "todo";
    return { section, key };
  }
  return { section, key: SECTIONS[section].tabs.find((t) => t.path === path)!.key };
}

export function SectionTabs({ counts }: { counts?: Partial<Record<CountKey, number>> }) {
  return (
    <Suspense fallback={<Tabs tab="" counts={counts} />}>
      <TabsWithParams counts={counts} />
    </Suspense>
  );
}

function TabsWithParams({ counts }: { counts?: Partial<Record<CountKey, number>> }) {
  const params = useSearchParams();
  return <Tabs tab={params?.get("tab") ?? ""} counts={counts} />;
}

function Tabs({ tab, counts }: { tab: string; counts?: Partial<Record<CountKey, number>> }) {
  const path = usePathname() ?? "/";
  const at = activeTab(path, tab);
  if (!at) return null;
  const section = SECTIONS[at.section];
  return (
    <nav aria-label={section.label} className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="flex min-w-max gap-1 border-b border-border">
        {section.tabs.map((t) => {
          const on = t.key === at.key;
          const n = t.count ? (counts?.[t.count] ?? 0) : 0;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cx(
                "-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[15px] font-medium md:min-h-10 md:text-sm",
                on ? "border-accent text-accent" : "border-transparent text-muted hover:text-text",
              )}
            >
              {t.label}
              {n > 0 && (
                <span className={cx("rounded-full px-1.5 text-xs font-semibold tabular-nums", on ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>
                  {n > 99 ? "99+" : n}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
