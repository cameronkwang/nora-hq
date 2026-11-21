import { checklistDone } from "@/lib/shoot-checklist";
import Link from "next/link";
import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import { assigneeFor, requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { currentMonth, isMonth, monthLabel, today } from "@/lib/dates";
import { listSchedule, reelsToPost } from "@/lib/ops-schedule";
import { Card, Count, PageHeader } from "@/components/ui";
import { TaskList, TaskRow } from "@/components/task-row";
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
 *  - Schedule (default): Nora's jobs by month, pasted from her notes or added by hand / by Claude. No amount.
 *  - Posts (?tab=posts): the content calendar of scheduled Instagram/TikTok posts. Old links that filter
 *    by business or platform (?client=… / ?platform=…) still open Posts.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  // Nora's calendar is her own: her jobs and her reminders. The Posts tab (the businesses' content calendar) is Cameron's.
  const nora = assigneeFor(user) === "nora";
  const sp = await searchParams;
  const tab = !nora && (one(sp.tab) === "posts" || (!sp.tab && ("client" in sp || "platform" in sp))) ? "posts" : "schedule";
  const month = isMonth(one(sp.month)) ? one(sp.month) : currentMonth();
  const tabs = nora ? null : <CalendarTabs tab={tab} month={month === currentMonth() ? "" : month} />;
  if (tab === "posts") return <PostsTab sp={sp} tabs={tabs} />;
  return <ScheduleTab sp={sp} month={month} tabs={tabs} nora={nora} />;
}

function CalendarTabs({ tab, month }: { tab: "schedule" | "posts"; month: string }) {
  const q = month ? `month=${month}` : "";
  const items = [
    { value: "schedule", label: "Schedule", href: q ? `/calendar?${q}` : "/calendar" },
    { value: "posts", label: "Posts", href: `/calendar?tab=posts${q ? `&${q}` : ""}` },
  ] as const;
  // Underline tabs: the current one is ink with a 2px ink line.
  return (
    <nav aria-label="Calendar views" className="tabs">
      {items.map((t) => (
        <Link key={t.value} href={t.href} aria-current={tab === t.value ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

async function ScheduleTab({ sp, month, tabs, nora }: { sp: SP; month: string; tabs: React.ReactNode; nora: boolean }) {
  const now = currentMonth();
  const show = one(sp.show);
  const filter: ScheduleFilter = show === "reels" || show === "free" ? show : "all";
  const [rows, pending, reminders] = await Promise.all([listSchedule(month), reelsToPost(), nora ? remindersIn(month) : Promise.resolve([])]);

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
    payment: r.payment, // Paid / Not paid from the linked deal, never an amount
    checklistDone: checklistDone(r.checklist),
  });
  const items = rows.map(toEntry);
  const otherReels = pending.filter((r) => r.month !== month).map(toEntry);
  const reelsThisMonth = items.filter((i) => i.needsReel && !i.reelPostedAt).length;

  return (
    <div>
      <div className="sched-head">
        <PageHeader
          title={nora ? "Calendar" : "Nora's schedule"}
          subtitle={<span className="num">{`${monthLabel(month)} · ${items.length} job${items.length === 1 ? "" : "s"} · ${reelsThisMonth} reel${reelsThisMonth === 1 ? "" : "s"} to post`}</span>}
          actions={
            <>
              <SchedulePaste />
              <ScheduleAddButton month={month} />
            </>
          }
        />
      </div>
      {tabs}
      <ScheduleBoard
        month={month}
        items={items}
        otherReels={otherReels}
        todayStr={today()}
        initialFilter={filter}
        // A server-made element rendered inside a client list: the key keeps React's list-key check quiet.
        monthPicker={<MonthPicker key="monthpick" month={month} current={now} />}
      />
      {nora && (
        <Card title={<>Reminders{reminders.length > 0 && <Count n={reminders.length} />}</>} actions={<Link href="/notes/new?kind=reminder" className="link-quiet">New reminder →</Link>} padded={false}>
          {reminders.length === 0 ? (
            <p className="sec-note">No reminders with a day in {monthLabel(month)}.</p>
          ) : (
            <TaskList>
              {reminders.map((t) => (
                <TaskRow key={t.id} task={t} showClient={false} showWho={false} />
              ))}
            </TaskList>
          )}
        </Card>
      )}
    </div>
  );
}

/** Nora's open reminders (her tasks) with a day in this month, soonest first. */
async function remindersIn(month: string) {
  const db = await getDb();
  const t = schema.tasks;
  return db
    .select()
    .from(t)
    .where(and(eq(t.assignee, "nora"), ne(t.status, "done"), gte(t.dueDate, `${month}-01`), lte(t.dueDate, `${month}-31`)))
    .orderBy(asc(t.dueDate), asc(t.createdAt))
    .limit(100);
}
