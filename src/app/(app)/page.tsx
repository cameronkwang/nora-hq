import Link from "next/link";
import { and, asc, eq, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { listClients } from "@/lib/data";
import { getClientMonth, type ClientMonth } from "@/lib/reports";
import { APP_TZ, currentMonth, monthLabel, relativeTime, today } from "@/lib/dates";
import { TaskList, TaskRow, isOverdue } from "@/components/task-row";
import { Card, EmptyState, PageHeader, ProgressBar, clientLabel, cx, formatNumber, humanize } from "@/components/ui";

export const dynamic = "force-dynamic";

/** At most this many rows in "Needs you"; the rest are one tap away. */
const NEEDS_YOU_MAX = 8;

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

/** Overall plan progress: each deliverable counts up to its target (targets of 0 = "as needed" are left out). */
function planProgress(cm: ClientMonth) {
  let done = 0;
  let target = 0;
  for (const p of cm.plan) {
    if (p.target <= 0) continue;
    target += p.target;
    done += Math.min(p.done, p.target);
  }
  return { done, target };
}

/** Views (IG + TikTok) for the latest month that has numbers, current month first. */
function latestViews(cm: ClientMonth) {
  for (const row of [...cm.metrics].reverse()) {
    if (row.instagram?.views != null || row.tiktok?.views != null) {
      return { month: row.month, views: (row.instagram?.views ?? 0) + (row.tiktok?.views ?? 0) };
    }
  }
  return null;
}

/** Split the "Needs you" slots between drafts and tasks so neither crowds the other out. */
function splitSlots(drafts: number, tasks: number, max = NEEDS_YOU_MAX) {
  const t = Math.min(tasks, Math.max(Math.ceil(max / 2), max - drafts));
  const d = Math.min(drafts, max - t);
  return { d, t };
}

export default async function Home() {
  const user = await requireUser();
  const db = await getDb();
  const month = currentMonth();
  const now = today();

  const openDue = and(ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lte(schema.tasks.dueDate, now));
  const clients = await listClients();
  const [cms, [asksWaiting], [draftCount], [dueCount], [overdueCount], pendingDrafts, dueTasks] = await Promise.all([
    Promise.all(clients.map((c) => getClientMonth(c.id, month))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(eq(schema.asks.status, "new")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(eq(schema.drafts.status, "needs_review")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks).where(openDue),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks)
      .where(and(ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lt(schema.tasks.dueDate, now))),
    db.select().from(schema.drafts).where(eq(schema.drafts.status, "needs_review")).orderBy(asc(schema.drafts.createdAt)).limit(NEEDS_YOU_MAX),
    db.select().from(schema.tasks).where(openDue).orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)).limit(NEEDS_YOU_MAX),
  ]);

  const months = cms.filter((x): x is ClientMonth => !!x);
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const first = user.name.split(" ")[0];
  const slots = splitSlots(pendingDrafts.length, dueTasks.length);
  const drafts = pendingDrafts.slice(0, slots.d);
  const tasks = dueTasks.slice(0, slots.t);
  const caughtUp = drafts.length === 0 && tasks.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${greeting()}, ${first}`} subtitle={todayLabel()} />

      {/* One compact row: the three things that can be waiting on you. */}
      <div className="-mt-2 grid grid-cols-3 gap-2 sm:gap-3">
        <Tile
          href="/review"
          value={draftCount.n}
          label="Drafts to review"
          primary
        />
        <Tile href="/asks" value={asksWaiting.n} label="Asks waiting" />
        <Tile
          href="/tasks"
          value={dueCount.n}
          label="Tasks due"
          hint={overdueCount.n > 0 ? <span className="font-semibold text-danger">{overdueCount.n} overdue</span> : null}
        />
      </div>

      <Card title="Needs you">
        {caughtUp ? (
          <EmptyState title="You’re all caught up.">No drafts waiting and nothing due today.</EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            {drafts.length > 0 && (
              <section>
                <SectionHead title="To review" href="/review" total={draftCount.n} shown={drafts.length} />
                <ul className="divide-y divide-border">
                  {drafts.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/review?draft=${d.id}`}
                        className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-medium">{d.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {humanize(d.kind)}
                            {d.clientId && names.get(d.clientId) ? ` · ${names.get(d.clientId)}` : ""} · {relativeTime(d.createdAt)}
                          </span>
                        </span>
                        <span aria-hidden className="shrink-0 text-muted">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {tasks.length > 0 && (
              <section>
                <SectionHead title="Due today or overdue" href="/tasks" total={dueCount.n} shown={tasks.length} />
                <TaskList>
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} />
                  ))}
                </TaskList>
              </section>
            )}
          </div>
        )}
      </Card>

      <section>
        <div className="mb-3 flex items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">Businesses</h2>
          <span className="text-sm text-muted">{monthLabel(month)}</span>
        </div>
        {months.length === 0 ? (
          <EmptyState title="No businesses yet.">
            <Link href="/clients" className="text-accent hover:underline">Add your first business</Link> to start tracking its monthly plan.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {months.map((cm) => (
              <BusinessCard key={cm.client.id} cm={cm} now={now} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ href, value, label, hint, primary }: { href: string; value: number; label: string; hint?: React.ReactNode; primary?: boolean }) {
  const hot = primary && value > 0;
  return (
    <Link
      href={href}
      className={cx(
        "flex min-h-11 flex-col justify-between rounded-xl border p-3 transition sm:p-4",
        hot ? "border-accent bg-accent text-accent-fg hover:opacity-90" : "border-border bg-surface hover:bg-surface-2",
      )}
    >
      <span className={cx("text-xs font-medium leading-tight", hot ? "opacity-90" : "text-muted")}>{label}</span>
      {/* hint sits beside the number so every tile's number lines up */}
      <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-xs leading-tight">{hint}</span> : null}
      </span>
    </Link>
  );
}

function SectionHead({ title, href, total, shown }: { title: string; href: string; total: number; shown: number }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {total > shown && (
        <Link href={href} className="-my-2 flex min-h-11 items-center text-xs font-medium text-accent hover:underline">
          See all {total} →
        </Link>
      )}
    </div>
  );
}

function BusinessCard({ cm, now }: { cm: ClientMonth; now: string }) {
  const { done, target } = planProgress(cm);
  const views = latestViews(cm);
  const id = cm.client.id;
  const overdue = cm.openTasks.filter((t) => isOverdue(t, now)).length;
  const open = cm.openTasks.length;
  const chips = [
    { n: cm.pendingDrafts, label: cm.pendingDrafts === 1 ? "draft" : "drafts", href: `/review?client=${id}`, cls: "text-accent" },
    { n: cm.unrepliedReviews, label: cm.unrepliedReviews === 1 ? "review" : "reviews", href: `/reviews?client=${id}`, cls: "text-google" },
    { n: overdue, label: "overdue", href: `/tasks?client=${id}`, cls: "text-danger" },
  ].filter((c) => c.n > 0);

  return (
    <article className="relative flex flex-col rounded-xl border border-border bg-surface p-4 transition hover:border-muted/50">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate font-semibold">
          {/* The whole card opens the business; the chips below stay their own links. */}
          <Link href={`/clients/${id}`} className="after:absolute after:inset-0 after:rounded-xl">
            {cm.client.name}
          </Link>
        </h3>
        {cm.client.location && <span className="shrink-0 truncate text-xs text-muted">{cm.client.location}</span>}
      </div>

      <div className="mt-3">
        {target > 0 ? (
          <>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-muted">Monthly plan</span>
              <span className="font-semibold tabular-nums">
                {done}/{target}
              </span>
            </div>
            <ProgressBar value={done} max={target} />
          </>
        ) : (
          <p className="text-xs text-muted">No monthly plan yet.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          <span className="font-semibold tabular-nums text-text">{open}</span> open {open === 1 ? "task" : "tasks"}
        </span>
        <span>
          {views ? (
            <>
              <span className="font-semibold tabular-nums text-text">{formatNumber(views.views)}</span> views · {monthLabel(views.month, "short")}
            </>
          ) : (
            "No views logged"
          )}
        </span>
      </div>

      {chips.length > 0 && (
        <p className="relative z-10 mt-3 flex flex-wrap items-center gap-x-1.5 border-t border-border pt-2 text-xs">
          {chips.map((c, i) => (
            <span key={c.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-muted">·</span>}
              <Link href={c.href} className={cx("inline-flex min-h-11 items-center font-semibold md:min-h-7 hover:underline", c.cls)}>
                {c.n} {c.label}
              </Link>
            </span>
          ))}
        </p>
      )}
    </article>
  );
}
