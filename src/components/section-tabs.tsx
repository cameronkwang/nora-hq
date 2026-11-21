"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

/**
 * Sections group several existing pages under one sidebar entry. Every page keeps its own URL;
 * the layout renders these tabs at the top of each member page so you can hop between them.
 */
export type SectionKey = "inbox" | "outreach" | "insights" | "invoices";
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
  // Invoicing (docs/invoicing.md): both Cameron and Nora see all three. /invoices/new and an invoice's own page are
  // detail pages of the section (no tab row), like /asks/new.
  invoices: {
    label: "Invoices",
    tabs: [
      { key: "invoices", label: "Invoices", href: "/invoices", path: "/invoices" },
      { key: "customers", label: "Customers", href: "/invoices/customers", path: "/invoices/customers" },
      { key: "inv-reports", label: "Reports", href: "/invoices/reports", path: "/invoices/reports" },
    ],
  },
};

/** The tabs Nora sees: her asks, plus her own collab requests and stats, and all of invoicing (it is her money). */
const NORA_TABS = new Set(["todo", "ideas", "done", "collabs", "stats", "invoices", "customers", "inv-reports"]);

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Which section a path belongs to (detail pages included) — drives the sidebar's active state. */
export function sectionOf(path: string): SectionKey | null {
  if (under(path, "/inbox")) return "inbox";
  if (under(path, "/outreach")) return "outreach";
  if (under(path, "/insights")) return "insights";
  if (under(path, "/invoices")) return "invoices";
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

export function SectionTabs({ counts, hideReview = false }: { counts?: Partial<Record<CountKey, number>>; hideReview?: boolean }) {
  return (
    <Suspense fallback={<Tabs tab="" counts={counts} hideReview={hideReview} />}>
      <TabsWithParams counts={counts} hideReview={hideReview} />
    </Suspense>
  );
}

function TabsWithParams({ counts, hideReview }: { counts?: Partial<Record<CountKey, number>>; hideReview: boolean }) {
  const params = useSearchParams();
  return <Tabs tab={params?.get("tab") ?? ""} counts={counts} hideReview={hideReview} />;
}

function Tabs({ tab, counts, hideReview }: { tab: string; counts?: Partial<Record<CountKey, number>>; hideReview: boolean }) {
  const path = usePathname() ?? "/";
  const at = activeTab(path, tab);
  if (!at) return null;
  const section = SECTIONS[at.section];
  // Nora (hideReview) sees only her own tabs; a section with one tab left needs no tab row.
  const tabs = section.tabs.filter((t) => !(hideReview && !NORA_TABS.has(t.key)));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={section.label} className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      {/* Text tabs on a hairline; the current one is ink with a 2px ink underline. Counts are plain cinnabar numerals. */}
      <div className="tabs min-w-max">
        {tabs.map((t) => {
          const on = t.key === at.key;
          const n = t.count ? (counts?.[t.count] ?? 0) : 0;
          return (
            <Link key={t.key} href={t.href} aria-current={on ? "page" : undefined}>
              {t.label}
              {n > 0 && <span className="count">{n > 99 ? "99+" : n}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
