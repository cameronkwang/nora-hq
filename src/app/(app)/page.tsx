import Link from "next/link";
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { assigneeFor, requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { countNewCollabRequests, isCreatorClient, listClients } from "@/lib/data";
import { getClientMonth, type ClientMonth } from "@/lib/reports";
import { APP_TZ, currentMonth, monthLabel, relativeTime, today } from "@/lib/dates";
import { askThreadState, listAskMessagesFor } from "@/lib/ops";
import { isAskRoute, personKey, type AskRoute } from "@/components/ask-route";
import { TaskList, TaskRow, isOverdue } from "@/components/task-row";
import { blobEnabled } from "@/lib/uploads";
import { QuickAsk } from "@/components/quick-ask";
import { NewClientLink } from "@/components/onboard-link";
import { Badge, Card, EmptyState, PageHeader, ProgressBar, clientLabel, cx, formatNumber, humanize } from "@/components/ui";

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

/** "For you": at most this many asks and tasks, and tasks due within this many days. */
const FOR_YOU_MAX = 5;
const FOR_YOU_DAYS = 2;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The short confirmation after "New ask" → Send. */
const SENT: Record<AskRoute, string> = {
  auto: "Sent. Claude will sort it out.",
  claude: "Sent to Claude.",
  cameron: "Sent to Cameron — it’s on his task list.",
  nora: "Sent to Nora — it’s on her task list.",
  idea: "Saved to Ideas.",
  fyi: "Noted. Claude will take it from here.",
};

/** Split the "Needs you" slots between drafts and tasks so neither crowds the other out. */
function splitSlots(drafts: number, tasks: number, max = NEEDS_YOU_MAX) {
  const t = Math.min(tasks, Math.max(Math.ceil(max / 2), max - drafts));
  const d = Math.min(drafts, max - t);
  return { d, t };
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const sent = isAskRoute(sp.sent) ? sp.sent : null;
  const db = await getDb();
  const month = currentMonth();
  const now = today();
  const me = personKey(assigneeFor(user));

  const openDue = and(ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lte(schema.tasks.dueDate, now));
  const clients = await listClients();
  const [newCollabs, cms, [asksWaiting], [draftCount], [dueCount], [overdueCount], pendingDrafts, dueTasks] = await Promise.all([
    countNewCollabRequests(),
    Promise.all(clients.map((c) => getClientMonth(c.id, month))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(and(eq(schema.asks.status, "new"), ne(schema.asks.kind, "idea"))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(eq(schema.drafts.status, "needs_review")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks).where(openDue),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks)
      .where(and(ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lt(schema.tasks.dueDate, now))),
    db.select().from(schema.drafts).where(eq(schema.drafts.status, "needs_review")).orderBy(asc(schema.drafts.createdAt)).limit(NEEDS_YOU_MAX),
    db.select().from(schema.tasks).where(openDue).orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)).limit(NEEDS_YOU_MAX),
  ]);

  const forYou = await getForYou(user.email, me, now);
  const forYouTaskIds = new Set(forYou.tasks.map((t) => t.id));

  // Nora's own workspace always leads the grid.
  const months = cms.filter((x): x is ClientMonth => !!x).sort((a, b) => Number(isCreatorClient(b.client)) - Number(isCreatorClient(a.client)));
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const first = user.name.split(" ")[0];
  // Tasks already shown under "For you" aren't repeated below.
  const otherDue = dueTasks.filter((t) => !forYouTaskIds.has(t.id));
  const slots = splitSlots(pendingDrafts.length, otherDue.length);
  const drafts = pendingDrafts.slice(0, slots.d);
  const tasks = otherDue.slice(0, slots.t);
  const hasForYou = forYou.asks.length > 0 || forYou.tasks.length > 0;
  const caughtUp = drafts.length === 0 && tasks.length === 0 && !hasForYou;

  return (
    <div className="flex flex-col gap-6">
      {/* Drop anything in — first thing on screen. */}
      <QuickAsk me={me} directUpload={blobEnabled()} />

      <PageHeader title={`${greeting()}, ${first}`} subtitle={todayLabel()} />

      {sent && (
        <p role="status" className="-mt-2 flex flex-wrap items-center justify-between gap-x-3 rounded-lg bg-ok-soft px-3 py-1 text-sm text-ok">
          <span className="py-1.5">{SENT[sent]}</span>
          <Link href="/asks/new" className="inline-flex min-h-11 items-center font-semibold hover:underline md:min-h-8">
            Add another
          </Link>
        </p>
      )}

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
          href="/tasks?scope=all"
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
            {hasForYou && (
              <section>
                <SectionHead title="For you" href={me ? "/asks?tab=me" : "/asks"} total={forYou.askTotal} shown={forYou.asks.length} />
                {forYou.asks.length > 0 && (
                  <ul className="divide-y divide-border">
                    {forYou.asks.map((a) => (
                      <li key={a.id}>
                        <Link href={`/asks/${a.id}`} className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{a.title}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                              {a.claudeAsked ? <Badge tone="warn">Claude asked a question</Badge> : <Badge tone="info">Ask for you</Badge>}
                              <span className="truncate">
                                {a.clientId && names.get(a.clientId) ? `${names.get(a.clientId)} · ` : ""}
                                {relativeTime(a.at)}
                              </span>
                            </span>
                          </span>
                          <span aria-hidden className="shrink-0 text-muted">›</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {forYou.tasks.length > 0 && (
                  <TaskList>
                    {forYou.tasks.map((t) => (
                      <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} />
                    ))}
                  </TaskList>
                )}
              </section>
            )}
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
                <SectionHead title="Due today or overdue" href="/tasks?scope=all" total={dueCount.n} shown={tasks.length} />
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
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{monthLabel(month)}</span>
            <NewClientLink />
          </div>
        </div>
        {months.length === 0 ? (
          <EmptyState title="No businesses yet.">
            <Link href="/clients/new" className="text-accent hover:underline">Add your first business</Link> to start tracking its monthly plan.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {months.map((cm) => (
              <BusinessCard key={cm.client.id} cm={cm} now={now} newCollabs={isCreatorClient(cm.client) ? newCollabs : 0} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * What's waiting on the signed-in person specifically: asks routed to them, asks where Claude is
 * waiting on their answer, and their own tasks due within a couple of days (or overdue).
 * Ideas never show here — they live in Asks → Ideas.
 */
async function getForYou(email: string, me: "cameron" | "nora" | null, now: string) {
  const db = await getDb();
  const open = inArray(schema.asks.status, ["new", "in_progress"]);
  const notIdea = ne(schema.asks.kind, "idea");
  const [candidates, tasks] = await Promise.all([
    db.select().from(schema.asks)
      .where(and(open, notIdea, me ? or(eq(schema.asks.forWho, me), and(eq(schema.asks.createdBy, email), eq(schema.asks.status, "in_progress"))) : and(eq(schema.asks.createdBy, email), eq(schema.asks.status, "in_progress"))))
      .orderBy(desc(schema.asks.updatedAt))
      .limit(40),
    me
      ? db.select().from(schema.tasks)
        .where(and(eq(schema.tasks.assignee, me), notInArray(schema.tasks.status, ["done"]), isNotNull(schema.tasks.dueDate), lte(schema.tasks.dueDate, addDays(now, FOR_YOU_DAYS))))
        .orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt))
        .limit(FOR_YOU_MAX)
      : Promise.resolve([] as schema.Task[]),
  ]);
  const threads = await listAskMessagesFor(candidates.filter((a) => a.status === "in_progress").map((a) => a.id));
  const asks = candidates
    .map((a) => {
      const thread = threads.get(a.id) ?? [];
      const claudeAsked = askThreadState(a, thread.at(-1), !!a.claudeNote || thread.some((m) => m.author === "claude")) === "claude_asked";
      const firstLine = a.body.split("\n").map((l) => l.trim()).find(Boolean) ?? "Ask";
      return { id: a.id, clientId: a.clientId, title: firstLine, at: a.updatedAt, claudeAsked, routed: !!me && a.forWho === me };
    })
    // Routed-to-me asks are only "for you" while they're in play; Claude's questions win the top spots.
    .filter((a) => a.routed || a.claudeAsked)
    .sort((x, y) => Number(y.claudeAsked) - Number(x.claudeAsked));
  return { asks: asks.slice(0, FOR_YOU_MAX), askTotal: asks.length, tasks };
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

function BusinessCard({ cm, now, newCollabs = 0 }: { cm: ClientMonth; now: string; newCollabs?: number }) {
  const creator = isCreatorClient(cm.client);
  const { done, target } = planProgress(cm);
  const views = latestViews(cm);
  const id = cm.client.id;
  const overdue = cm.openTasks.filter((t) => isOverdue(t, now)).length;
  const open = cm.openTasks.length;
  const chips = [
    { n: newCollabs, label: newCollabs === 1 ? "new collab request" : "new collab requests", href: "/collabs", cls: "text-accent" },
    { n: cm.pendingDrafts, label: cm.pendingDrafts === 1 ? "draft" : "drafts", href: `/review?client=${id}`, cls: "text-accent" },
    { n: cm.unrepliedReviews, label: cm.unrepliedReviews === 1 ? "review" : "reviews", href: `/reviews?client=${id}`, cls: "text-google" },
    { n: overdue, label: "overdue", href: `/tasks?client=${id}&scope=all`, cls: "text-danger" },
  ].filter((c) => c.n > 0);

  return (
    <article
      className={cx(
        "relative flex flex-col rounded-xl border p-4 transition",
        creator ? "border-accent/40 bg-accent-soft hover:border-accent" : "border-border bg-surface hover:border-muted/50",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex min-w-0 items-baseline gap-2 font-semibold">
          {/* The whole card opens the business; the chips below stay their own links. */}
          <Link href={`/clients/${id}`} className="truncate after:absolute after:inset-0 after:rounded-xl">
            {cm.client.name}
          </Link>
          {creator && <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-accent">Creator</span>}
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
