import Link from "next/link";
import { and, asc, desc, eq, inArray, isNotNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
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
import { HealthLine, loadClientHealth } from "@/components/client-health-strip";
import type { ClientHealthRow } from "@/lib/data";
import { HomeRow, NoraHome } from "@/components/nora-home";
import { KIND_LABELS } from "@/components/draft-checks";
import { Card, Count, EmptyState, PageHeader, ProgressBar, Status, Tag, clientLabel, formatNumber, humanize } from "@/components/ui";

export const dynamic = "force-dynamic";

/** At most this many rows waiting on you (To approve and Tasks together); the rest are one tap away. */
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
  auto: "Sent. Claude picks up what it can; the rest goes to Cameron.",
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

  // After "New ask" → Send: one line between hairlines, and the way to add another.
  const sentNote = sent && (
    <p role="status" className="notice">
      <Status tone="ok" className="whitespace-normal">{SENT[sent]}</Status>
      <Link href="/asks/new" className="link inline-flex min-h-11 items-center md:pointer-fine:min-h-0">
        Add another
      </Link>
    </p>
  );

  // Nora's Home is her day (shoots, reels, payments, her asks), not the agency dashboard.
  if (me === "nora") {
    const [forYou, clients] = await Promise.all([getForYou(user.email, me, now), listClients()]);
    const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
    return (
      <div>
        <PageHeader title={`${greeting()}, ${user.name.split(" ")[0]}`} subtitle={todayLabel()} />
        <QuickAsk me={me} directUpload={blobEnabled()} />
        <div className="home-notes">
          <NotifyHomeCard />
          {sentNote}
        </div>
        {(forYou.asks.length > 0 || forYou.tasks.length > 0) && (
          <Card title="For you" padded={false}>
            <div className="approve-stack">
              {forYou.asks.length > 0 && (
                <ul className="list">
                  {forYou.asks.map((a) => (
                    <HomeRow
                      key={a.id}
                      href={`/asks/${a.id}`}
                      title={a.title}
                      clamp
                      note={a.claudeAsked ? <Status tone="warn" small>Claude asked a question</Status> : <Status tone="info" small>Ask for you</Status>}
                      when={relativeTime(a.at)}
                    />
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
            </div>
          </Card>
        )}
        <NoraHome email={user.email} name={user.name} now={now} skipAskIds={forYou.asks.map((a) => a.id)} />
      </div>
    );
  }

  const openDue = and(ne(schema.tasks.status, "done"), isNotNull(schema.tasks.dueDate), lte(schema.tasks.dueDate, now));
  const clients = await listClients();
  const [newCollabs, cms, [asksWaiting], [draftCount], [dueCount], pendingDrafts, dueTasks, health] = await Promise.all([
    countNewCollabRequests(),
    Promise.all(clients.map((c) => getClientMonth(c.id, month))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(and(eq(schema.asks.status, "new"), ne(schema.asks.kind, "idea"))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(eq(schema.drafts.status, "needs_review")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks).where(openDue),
    db.select().from(schema.drafts).where(eq(schema.drafts.status, "needs_review")).orderBy(asc(schema.drafts.createdAt)).limit(NEEDS_YOU_MAX),
    db.select().from(schema.tasks).where(openDue).orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)).limit(NEEDS_YOU_MAX),
    loadClientHealth(),
  ]);

  const forYou = await getForYou(user.email, me, now);
  const forYouTaskIds = new Set(forYou.tasks.map((t) => t.id));

  // Nora's own workspace always leads the Businesses ledger.
  const months = cms.filter((x): x is ClientMonth => !!x).sort((a, b) => Number(isCreatorClient(b.client)) - Number(isCreatorClient(a.client)));
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const first = user.name.split(" ")[0];
  // Tasks already shown under "For you" aren't repeated below.
  const otherDue = dueTasks.filter((t) => !forYouTaskIds.has(t.id));
  // The Tasks title counts what that section lists: every task due today or overdue, less the ones under For you.
  const dueElsewhere = forYou.tasks.filter((t) => t.status !== "done" && !!t.dueDate && t.dueDate <= now).length;
  const dueHere = Math.max(0, dueCount.n - dueElsewhere);
  const slots = splitSlots(pendingDrafts.length, otherDue.length);
  const drafts = pendingDrafts.slice(0, slots.d);
  const tasks = otherDue.slice(0, slots.t);
  const hasForYou = forYou.asks.length > 0 || forYou.tasks.length > 0;
  const caughtUp = drafts.length === 0 && tasks.length === 0 && !hasForYou;

  // The count of new asks in the Inbox (it was a tile) is the quiet action of the first section. It counts every new
  // ask, not only the ones for you, so it says where the number comes from.
  const asksLink = asksWaiting.n > 0 ? (
    <Link href="/asks" className="link-quiet">
      {asksWaiting.n} new in Inbox →
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
        {sentNote}
      </div>

      {/* What is waiting, by kind. Each count sits in its section title (and in the sidebar), not in a tile. */}
      <div className="mt-10 flex flex-col gap-10 max-md:mt-8 max-md:gap-8">
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
                          <HomeRow
                            key={a.id}
                            href={`/asks/${a.id}`}
                            title={a.title}
                            clamp
                            note={a.claudeAsked ? <Status tone="warn" small>Claude asked a question</Status> : <Status tone="info" small>Ask for you</Status>}
                            where={a.clientId ? names.get(a.clientId) : null}
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
                actions={draftCount.n > drafts.length ? <Link href="/review" className="link-quiet">See all {draftCount.n} →</Link> : undefined}
                padded={false}
              >
                <ul className="list">
                  {drafts.map((d) => (
                    <HomeRow
                      key={d.id}
                      href={`/review?draft=${d.id}`}
                      title={d.title}
                      clamp
                      note={<span className="meta">{KIND_LABELS[d.kind] ?? humanize(d.kind)}</span>}
                      where={d.clientId ? names.get(d.clientId) : null}
                      when={relativeTime(d.createdAt)}
                    />
                  ))}
                </ul>
              </Card>
            )}
            {tasks.length > 0 && (
              <Card
                title={<>Tasks <Count n={dueHere} /></>}
                actions={<Link href="/tasks?scope=all" className="link-quiet">{dueHere > tasks.length ? `See all ${dueHere} →` : "All tasks →"}</Link>}
                padded={false}
              >
                <p className="sec-note">Due today or overdue</p>
                <TaskList>
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} />
                  ))}
                </TaskList>
              </Card>
            )}
          </>
        )}

        {/* The month, one row per business: its health (a dot and its single worst issue, or "All good"), what is
            waiting there, the plan, open tasks and views. The one list of businesses on Home. */}
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
                <BusinessRow key={cm.client.id} cm={cm} now={now} health={health.get(cm.client.id)} newCollabs={isCreatorClient(cm.client) ? newCollabs : 0} />
              ))}
            </ul>
          )}
        </Card>
      </div>
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
 * One business in the ledger: its name, its health (the single worst issue, or "All good") and the drafts waiting
 * there, then this month's plan, open tasks and latest views. Unanswered reviews and overdue tasks are health issues,
 * so they are said once, in the health line. Nora's own workspace has no health line; it shows new collab requests.
 */
function BusinessRow({ cm, now, health, newCollabs = 0 }: { cm: ClientMonth; now: string; health?: ClientHealthRow; newCollabs?: number }) {
  const creator = isCreatorClient(cm.client);
  const { done, target } = planProgress(cm);
  const views = latestViews(cm);
  const id = cm.client.id;
  const open = cm.openTasks.length;
  // Without a health line (Nora's workspace, or health failed to load) the review and overdue counts stay as links.
  const overdue = health ? 0 : cm.openTasks.filter((t) => isOverdue(t, now)).length;
  const reviews = health ? 0 : cm.unrepliedReviews;
  // What is waiting there, as ink links joined by middle dots (no coloured words).
  const chips = [
    { n: newCollabs, label: newCollabs === 1 ? "new collab request" : "new collab requests", href: "/collabs" },
    { n: cm.pendingDrafts, label: cm.pendingDrafts === 1 ? "draft" : "drafts", href: `/review?client=${id}` },
    { n: reviews, label: reviews === 1 ? "review" : "reviews", href: `/reviews?client=${id}` },
    { n: overdue, label: "overdue", href: `/tasks?client=${id}&scope=all` },
  ].filter((c) => c.n > 0);

  return (
    <li className="ledger-row">
      <div className="ledger-main">
        <span className="ledger-name">
          <Link href={`/clients/${id}`} className="row-title tap-target">
            {cm.client.name}
          </Link>
          {creator && <Tag>Creator</Tag>}
          {cm.client.location && <span className="meta">{cm.client.location}</span>}
        </span>
        {(health || chips.length > 0) && (
          <span className="ledger-wait">
            {health && (
              <span>
                <HealthLine row={health} />
              </span>
            )}
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
