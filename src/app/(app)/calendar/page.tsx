import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { currentMonth, isMonth, monthLabel, today } from "@/lib/dates";
import { listSchedule, reelsToPost } from "@/lib/ops-schedule";
import { PageHeader, cx } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { ScheduleBoard, type ScheduleFilter, type ScheduleEntry } from "@/components/schedule-board";
import { SchedulePaste } from "@/components/schedule-paste";
import { ScheduleAddButton } from "@/components/schedule-item-form";
import { PostsTab } from "./posts-tab";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * /calendar — two tabs:
 *  - Schedule (default): Nora's jobs by month, pasted from her notes or added by hand / by Claude. No money.
 *  - Posts (?tab=posts): the content calendar of scheduled Instagram/TikTok posts. Old links that filter
 *    by business or platform (?client=… / ?platform=…) still open Posts.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const tab = one(sp.tab) === "posts" || (!sp.tab && ("client" in sp || "platform" in sp)) ? "posts" : "schedule";
  const month = isMonth(one(sp.month)) ? one(sp.month) : currentMonth();
  const tabs = <CalendarTabs tab={tab} month={month === currentMonth() ? "" : month} />;
  if (tab === "posts") return <PostsTab sp={sp} tabs={tabs} />;
  return <ScheduleTab sp={sp} month={month} tabs={tabs} />;
}

function CalendarTabs({ tab, month }: { tab: "schedule" | "posts"; month: string }) {
  const q = month ? `month=${month}` : "";
  const items = [
    { value: "schedule", label: "Schedule", href: q ? `/calendar?${q}` : "/calendar" },
    { value: "posts", label: "Posts", href: `/calendar?tab=posts${q ? `&${q}` : ""}` },
  ] as const;
  return (
    <nav aria-label="Calendar views" className="mb-5 flex border-b border-border">
      {items.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          aria-current={tab === t.value ? "page" : undefined}
          className={cx(
            "-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-medium",
            tab === t.value ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

async function ScheduleTab({ sp, month, tabs }: { sp: SP; month: string; tabs: React.ReactNode }) {
  const now = currentMonth();
  const show = one(sp.show);
  const filter: ScheduleFilter = show === "reels" || show === "free" ? show : "all";
  const [rows, pending] = await Promise.all([listSchedule(month), reelsToPost()]);

  const toEntry = (r: (typeof rows)[number]): ScheduleEntry => ({
    id: r.id,
    month: r.month,
    date: r.date,
    businessName: r.businessName,
    clientId: r.clientId,
    clientName: r.clientName,
    isFree: r.isFree,
    needsReel: r.needsReel,
    reelPostedAt: r.reelPostedAt ? r.reelPostedAt.toISOString() : null,
    dealId: r.dealId,
    payment: r.payment, // Paid / Not paid from the linked deal — never an amount
  });
  const items = rows.map(toEntry);
  const otherReels = pending.filter((r) => r.month !== month).map(toEntry);
  const reelsThisMonth = items.filter((i) => i.needsReel && !i.reelPostedAt).length;

  return (
    <div>
      <PageHeader
        title="Nora's schedule"
        subtitle={`${monthLabel(month)} · ${items.length} job${items.length === 1 ? "" : "s"} · ${reelsThisMonth} reel${reelsThisMonth === 1 ? "" : "s"} to post`}
        actions={
          <>
            <SchedulePaste />
            <ScheduleAddButton month={month} />
          </>
        }
      />
      {tabs}
      <div className="mb-4">
        <MonthPicker month={month} current={now} />
      </div>
      <ScheduleBoard month={month} items={items} otherReels={otherReels} todayStr={today()} initialFilter={filter} />
    </div>
  );
}
