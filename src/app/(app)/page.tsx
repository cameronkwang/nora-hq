import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
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
import { NotifyHomeCard } from "@/components/notify-home-card";
import { NEW_CLIENT_HREF } from "@/components/onboard-link";
import { ClientHealth } from "@/components/client-health-strip";
import { KIND_LABELS } from "@/components/draft-checks";
import { Card, Count, EmptyState, PageHeader, ProgressBar, Status, Tag, clientLabel, formatNumber, humanize } from "@/components/ui";

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
  cameron: "Sent to Cameron. It’s on his task list.",
  nora: "Sent to Nora. It’s on her task list.",
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

  // Nora's own workspace always leads the Businesses ledger.
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

  const asksLink = asksWaiting.n > 0 ? (
    <Link href="/asks" className="link-quiet">
      {asksWaiting.n} {asksWaiting.n === 1 ? "ask" : "asks"} waiting →
    </Link>
  ) : undefined;

  return (
    <div>
      <PageHeader title={`${greeting()}, ${first}`} subtitle={todayLabel()} />

      {/* Drop anything in: the first thing under the greeting. */}
      <QuickAsk me={me} directUpload={blobEnabled()} />

      <div className="home-notes">
        {/* One-time "turn on phone alerts" prompt; hides itself once handled. */}
        <NotifyHomeCard />
        {sent && (
          <p role="status" className="notice">
            <Status tone="ok" className="whitespace-normal">{SENT[sent]}</Status>
            <Link href="/asks/new" className="link inline-flex min-h-11 items-center md:min-h-0">
              Add another
            </Link>
          </p>
        )}
        {/* One row per business: a colored dot and its single worst issue (or "All good"). */}
        <ClientHealth />
      </div>

      {/* What is waiting, by kind. Each count sits in its section title (and in the sidebar), not in a tile. */}
      <div className="cols">
        <div>
          {caughtUp ? (
            <Card title="Needs you" actions={asksLink}>
              <EmptyState title="You’re all caught up.">No drafts waiting and nothing due today.</EmptyState>
            </Card>
          ) : (
            <>
              {(hasForYou || asksWaiting.n > 0) && (
                <Card title="For you" actions={asksLink} padded={false}>
                  {hasForYou ? (
                    <div className="approve-stack">
                      {forYou.asks.length > 0 && (
                        <ul className="list">
                          {forYou.asks.map((a) => (
                            <QueueRow
                              key={a.id}
                              href={`/asks/${a.id}`}
                              title={a.title}
                              clamp
                              note={a.claudeAsked ? <Status tone="warn" small>Claude asked a question</Status> : <Status tone="info" small>Ask for you</Status>}
                              business={a.clientId ? names.get(a.clientId) : null}
                              when={relativeTime(a.at)}
                            />
                          ))}
                          {forYou.askTotal > forYou.asks.length && (
                            <li>
                              <Link href={me ? "/asks?tab=me" : "/asks"} className="row link-quiet">
                                See all {forYou.askTotal} asks for you →
                              </Link>
                            </li>
                          )}
                        </ul>
                      )}
                      {forYou.tasks.length > 0 && (
                        <TaskList>
                          {forYou.tasks.map((t) => (
                            <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} />
                          ))}
                        </TaskList>
                      )}
                    </div>
                  ) : (
                    <EmptyState title="Nothing routed to you">Asks for you and your own tasks due soon show up here.</EmptyState>
                  )}
                </Card>
              )}
              {drafts.length > 0 && (
                <Card
                  title={<>To approve <Count n={draftCount.n} /></>}
                  actions={<Link href="/review" className="link-quiet">See all {draftCount.n} →</Link>}
                  padded={false}
                >
                  <ul className="list">
                    {drafts.map((d) => (
                      <QueueRow
                        key={d.id}
                        href={`/review?draft=${d.id}`}
                        title={d.title}
                        note={<span className="meta">{KIND_LABELS[d.kind] ?? humanize(d.kind)}</span>}
                        business={d.clientId ? names.get(d.clientId) : null}
                        when={relativeTime(d.createdAt)}
                      />
                    ))}
                  </ul>
                </Card>
              )}
              {dueCount.n > 0 && (
                <Card
                  title={
                    <>
                      Tasks <Count n={dueCount.n} />
                      {overdueCount.n > 0 && <span className="meta text-danger">{overdueCount.n} overdue</span>}
                    </>
                  }
                  actions={<Link href="/tasks?scope=all" className="link-quiet">All tasks →</Link>}
                  padded={false}
                >
                  {tasks.length > 0 ? (
                    <TaskList>
                      {tasks.map((t) => (
                        <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} />
                      ))}
                    </TaskList>
                  ) : (
                    <p className="sec-note">Due today or overdue. They are listed under For you.</p>
                  )}
                </Card>
              )}
            </>
          )}
        </div>

        <aside>
          <NoraWeek now={now} />
        </aside>
      </div>

      <Card
        title="Businesses"
        className="[&>.sec-head]:flex-wrap"
        actions={
          <span className="flex items-baseline gap-4">
            <span className="meta whitespace-nowrap">{monthLabel(month)}</span>
            <Link href={NEW_CLIENT_HREF} className="link-quiet inline-flex items-baseline gap-1">
              <svg viewBox="0 0 16 16" aria-hidden className="size-3 self-center" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
              New client
            </Link>
          </span>
        }
        padded={false}
      >
        {months.length === 0 ? (
          <EmptyState title="No businesses yet.">
            <Link href="/clients/new" className="link">Add your first business</Link> to start tracking its monthly plan.
          </EmptyState>
        ) : (
          <ul className="list">
            {months.map((cm) => (
              <BusinessRow key={cm.client.id} cm={cm} now={now} newCollabs={isCreatorClient(cm.client) ? newCollabs : 0} />
            ))}
          </ul>
        )}
      </Card>
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

/**
 * One thing waiting (an ask, a draft): title, one more fact, the business, when. One line wide, two lines narrow.
 * `clamp` is for a title that is free text (an ask's first line): one line with an ellipsis wide, two lines narrow.
 */
function QueueRow({ href, title, note, business, when, clamp }: { href: string; title: string; note?: React.ReactNode; business?: string | null; when: string; clamp?: boolean }) {
  return (
    <li>
      <Link href={href} className="row approve-row">
        <span className={clamp ? "approve-main is-clamp" : "approve-main"}>
          <span className="row-title">{title}</span>
          {note && <span className="approve-note max-lg:hidden">{note}</span>}
        </span>
        <span className="row-meta">
          {note && <span className="lg:hidden">{note}</span>}
          {business && <span className="meta where" title={business}>{business}</span>}
          <span className="meta when">{when}</span>
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

function Chevron() {
  return (
    <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const dayPart = (date: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(utc(date));

/**
 * Nora's week: the next seven days of her schedule as an agenda (the day in the margin, the visits beside it).
 * Read-only, and never an amount: the schedule has no money in it. A failure here never takes Home down.
 */
async function NoraWeek({ now }: { now: string }) {
  const end = addDays(now, 6);
  let rows: schema.ScheduleItem[];
  try {
    const db = await getDb();
    rows = await db
      .select()
      .from(schema.scheduleItems)
      .where(and(gte(schema.scheduleItems.date, now), lte(schema.scheduleItems.date, end)))
      .orderBy(asc(schema.scheduleItems.date), asc(schema.scheduleItems.businessName));
  } catch (e) {
    console.error("[home] week failed", e);
    return null;
  }
  const days = new Map<string, schema.ScheduleItem[]>();
  for (const r of rows) if (r.date) days.set(r.date, [...(days.get(r.date) ?? []), r]);
  const sameMonth = now.slice(0, 7) === end.slice(0, 7);
  const range = `${dayPart(now, { month: "short", day: "numeric" })} – ${sameMonth ? dayPart(end, { day: "numeric" }) : dayPart(end, { month: "short", day: "numeric" })}`;

  return (
    <Card title={<>Nora’s week <span className="meta whitespace-nowrap">{range}</span></>} actions={<Link href="/calendar" className="link-quiet">Schedule →</Link>} padded={false}>
      {days.size === 0 ? (
        <EmptyState title="Nothing on the schedule this week" />
      ) : (
        <ol className="agenda">
          {[...days].map(([date, items]) => (
            <li key={date} className={date === now ? "is-today" : undefined}>
              <div className="day-date" aria-label={`${dayPart(date, { weekday: "long", month: "long", day: "numeric" })}${date === now ? ", today" : ""}`}>
                <span className="eyebrow dow">{dayPart(date, { weekday: "short" })}</span>
                <span className="dom">{dayPart(date, { day: "numeric" })}</span>
              </div>
              <ul className="list">
                {items.map((it) => (
                  <li key={it.id} className="row">
                    <span className="row-title">
                      {it.businessName}
                      {it.isFree && <Tag>Free</Tag>}
                    </span>
                    {it.needsReel && !it.reelPostedAt &&
                      (date <= now ? (
                        <span className="reel">
                          <span className="emoji" aria-hidden>📸</span> Reel to post
                        </span>
                      ) : (
                        <span className="reel is-later">
                          <span className="emoji" role="img" aria-label="Reel">📸</span>
                        </span>
                      ))}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** One business in the ledger: its name (and what is waiting there), this month's plan, open tasks, latest views. */
function BusinessRow({ cm, now, newCollabs = 0 }: { cm: ClientMonth; now: string; newCollabs?: number }) {
  const creator = isCreatorClient(cm.client);
  const { done, target } = planProgress(cm);
  const views = latestViews(cm);
  const id = cm.client.id;
  const overdue = cm.openTasks.filter((t) => isOverdue(t, now)).length;
  const open = cm.openTasks.length;
  const chips = [
    { n: newCollabs, label: newCollabs === 1 ? "new collab request" : "new collab requests", href: "/collabs" },
    { n: cm.pendingDrafts, label: cm.pendingDrafts === 1 ? "draft" : "drafts", href: `/review?client=${id}` },
    { n: cm.unrepliedReviews, label: cm.unrepliedReviews === 1 ? "review" : "reviews", href: `/reviews?client=${id}` },
    { n: overdue, label: "overdue", href: `/tasks?client=${id}&scope=all` },
  ].filter((c) => c.n > 0);

  return (
    <li className="ledger-row">
      <div className="ledger-main">
        <span className="ledger-name">
          <Link href={`/clients/${id}`} className="row-title">
            {cm.client.name}
          </Link>
          {creator && <Tag>Creator</Tag>}
          {cm.client.location && <span className="meta">{cm.client.location}</span>}
        </span>
        {chips.length > 0 && (
          <span className="ledger-wait">
            {chips.map((c) => (
              <span key={c.label}>
                <Link href={c.href} className="link">
                  {c.n} {c.label}
                </Link>
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="ledger-stats">
        {target > 0 ? (
          <div className="ledger-plan meta">
            <span>Plan</span>{" "}
            <ProgressBar value={done} max={target} />
            <span className="num">
              <b>{done}</b> of {target}
            </span>
          </div>
        ) : (
          <span className="meta">No monthly plan yet.</span>
        )}
        <span className="meta num">
          <b>{open}</b> open {open === 1 ? "task" : "tasks"}
        </span>
        <span className="meta ledger-views">
          {views ? (
            <>
              <b>{formatNumber(views.views)}</b> views · {monthLabel(views.month, "short")}
            </>
          ) : (
            "No views logged"
          )}
        </span>
      </div>
    </li>
  );
}
