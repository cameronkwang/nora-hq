import Link from "next/link";
import { and, asc, desc, eq, gte, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { listClients } from "@/lib/data";
import { getClientMonth, type ClientMonth } from "@/lib/reports";
import { APP_TZ, currentMonth, monthLabel, relativeTime, today } from "@/lib/dates";
import { TaskList, TaskRow } from "@/components/task-row";
import { Card, EmptyState, LinkButton, PageHeader, ProgressBar, Stat, clientLabel, cx, formatNumber, humanize } from "@/components/ui";
import { actorName, entityHref } from "./activity/actor";

export const dynamic = "force-dynamic";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
    const v = (row.instagram?.views ?? 0) + (row.tiktok?.views ?? 0);
    if (row.instagram?.views != null || row.tiktok?.views != null) return { month: row.month, views: v };
  }
  return null;
}

export default async function Home() {
  const user = await requireUser();
  const db = await getDb();
  const month = currentMonth();
  const now = today();
  const weekEnd = addDays(now, 6);

  const clients = await listClients();
  const [cms, [newAsks], [draftCount], [dueWeek], [overdueCount], pendingDrafts, overdueTasks, recent] = await Promise.all([
    Promise.all(clients.map((c) => getClientMonth(c.id, month))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(eq(schema.asks.status, "new")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(eq(schema.drafts.status, "needs_review")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks)
      .where(and(ne(schema.tasks.status, "done"), gte(schema.tasks.dueDate, now), lte(schema.tasks.dueDate, weekEnd))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks)
      .where(and(ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lt(schema.tasks.dueDate, now))),
    db.select().from(schema.drafts).where(eq(schema.drafts.status, "needs_review")).orderBy(asc(schema.drafts.createdAt)).limit(6),
    db.select().from(schema.tasks)
      .where(and(ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lt(schema.tasks.dueDate, now)))
      .orderBy(asc(schema.tasks.dueDate)).limit(8),
    db.select().from(schema.activity).orderBy(desc(schema.activity.createdAt)).limit(10),
  ]);

  const months = cms.filter((x): x is ClientMonth => !!x);
  const contacted = months.reduce((s, m) => s + m.contactedThisMonth, 0);
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const first = user.name.split(" ")[0];
  const caughtUp = pendingDrafts.length === 0 && overdueTasks.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${greeting()}, ${first}`}
        subtitle={`${monthLabel(month)} at a glance.`}
        actions={
          <>
            <LinkButton href="/asks/new" variant="primary">+ New ask</LinkButton>
            <LinkButton href="/tasks">All tasks</LinkButton>
          </>
        }
      />

      <div className="-mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/asks" className="rounded-xl hover:opacity-90">
          <Stat label="New asks" value={newAsks.n} hint={newAsks.n ? "Waiting for Claude" : "Queue is empty"} />
        </Link>
        <Link href="/review" className="rounded-xl hover:opacity-90">
          <Stat label="Drafts to review" value={draftCount.n} hint={draftCount.n ? "Need a yes or no" : "Nothing waiting"} />
        </Link>
        <Link href="/tasks" className="rounded-xl hover:opacity-90">
          <Stat
            label="Tasks due this week"
            value={dueWeek.n}
            hint={overdueCount.n ? <span className="font-semibold text-danger">{overdueCount.n} overdue</span> : "None overdue"}
          />
        </Link>
        <Link href="/creators" className="rounded-xl hover:opacity-90">
          <Stat label="Creators contacted" value={contacted} hint={`In ${monthLabel(month, "short")}`} />
        </Link>
      </div>

      <Card title="Needs you">
        {caughtUp ? (
          <EmptyState title="You’re all caught up.">No drafts waiting and nothing overdue.</EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            {pendingDrafts.length > 0 && (
              <section>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Drafts to review</h3>
                  <Link href="/review" className="text-xs font-medium text-accent hover:underline">
                    Review queue{draftCount.n > pendingDrafts.length ? ` (${draftCount.n})` : ""} →
                  </Link>
                </div>
                <ul className="divide-y divide-border">
                  {pendingDrafts.map((d) => (
                    <li key={d.id}>
                      <Link href={`/review?draft=${d.id}`} className="flex flex-col gap-0.5 py-2.5 hover:opacity-80 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <span className="min-w-0 break-words text-sm font-medium">{d.title}</span>
                        <span className="shrink-0 text-xs text-muted">
                          {humanize(d.kind)}
                          {d.clientId && names.get(d.clientId) ? ` · ${names.get(d.clientId)}` : ""} · {relativeTime(d.createdAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {overdueTasks.length > 0 && (
              <section>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-danger">Overdue tasks</h3>
                  {overdueCount.n > overdueTasks.length && (
                    <Link href="/tasks" className="text-xs font-medium text-accent hover:underline">
                      All {overdueCount.n} →
                    </Link>
                  )}
                </div>
                <TaskList>
                  {overdueTasks.map((t) => (
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
          <h2 className="text-lg font-semibold">Businesses · {monthLabel(month)}</h2>
          <Link href="/clients" className="text-sm text-accent hover:underline">
            Manage
          </Link>
        </div>
        {months.length === 0 ? (
          <EmptyState title="No businesses yet.">
            <Link href="/clients" className="text-accent hover:underline">Add your first business</Link> to start tracking its monthly plan.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {months.map((cm) => (
              <BusinessCard key={cm.client.id} cm={cm} />
            ))}
          </div>
        )}
      </section>

      <Card
        title="Recent activity"
        actions={
          <Link href="/activity" className="text-xs font-medium text-accent hover:underline">
            See all
          </Link>
        }
      >
        {recent.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Changes by you, Nora, Cameron or Claude show up here.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {recent.map((a) => {
              const link = a.action.endsWith(".deleted") ? null : entityHref(a.entityType, a.entityId, a.clientId);
              return (
                <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <p className="min-w-0 break-words">
                    <span className="font-semibold">{actorName(a.actor)}</span>{" "}
                    {link ? (
                      <Link href={link} className="hover:underline">
                        {a.summary}
                      </Link>
                    ) : (
                      a.summary
                    )}
                  </p>
                  <span className="shrink-0 text-xs text-muted">{relativeTime(a.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BusinessCard({ cm }: { cm: ClientMonth }) {
  const { done, target } = planProgress(cm);
  const views = latestViews(cm);
  const items: Array<{ label: string; value: number; href: string; alert?: boolean }> = [
    { label: "Open tasks", value: cm.openTasks.length, href: `/tasks?client=${cm.client.id}` },
    { label: "Drafts to review", value: cm.pendingDrafts, href: `/review?client=${cm.client.id}`, alert: cm.pendingDrafts > 0 },
    { label: "Unreplied reviews", value: cm.unrepliedReviews, href: `/reviews?client=${cm.client.id}`, alert: cm.unrepliedReviews > 0 },
    { label: "Creators contacted", value: cm.contactedThisMonth, href: `/clients/${cm.client.id}` },
  ];

  return (
    <article className="flex flex-col rounded-xl border border-border bg-surface p-4">
      <Link href={`/clients/${cm.client.id}`} className="group min-w-0">
        <h3 className="truncate font-semibold group-hover:underline">{cm.client.name}</h3>
        <p className="truncate text-xs text-muted">{cm.client.location ?? " "}</p>
      </Link>

      <div className="mt-3">
        {target > 0 ? (
          <>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-muted">Monthly plan</span>
              <span className="font-semibold tabular-nums">
                {done}/{target} · {Math.round((done / target) * 100)}%
              </span>
            </div>
            <ProgressBar value={done} max={target} />
          </>
        ) : (
          <p className="text-xs text-muted">
            No monthly plan yet.{" "}
            <Link href={`/clients/${cm.client.id}`} className="text-accent hover:underline">
              Set one up
            </Link>
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {items.map((it) => (
          <Link key={it.label} href={it.href} className="rounded-lg bg-surface-2 px-2.5 py-2 hover:opacity-80">
            <span className="block text-[11px] leading-tight text-muted">{it.label}</span>
            <span className={cx("block text-lg font-semibold tabular-nums", it.alert && "text-warn")}>{it.value}</span>
          </Link>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <span>
          {views ? (
            <>
              Views {monthLabel(views.month, "short")}: <span className="font-semibold text-text">{formatNumber(views.views)}</span>
            </>
          ) : (
            "No views logged yet"
          )}
        </span>
        <Link href={`/clients/${cm.client.id}`} className="font-medium text-accent hover:underline">
          Open →
        </Link>
      </div>
    </article>
  );
}
