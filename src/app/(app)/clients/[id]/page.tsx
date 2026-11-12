import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, assigneeFor } from "@/lib/auth";
import { getClientMonth, type ClientMonth } from "@/lib/reports";
import { addMonths, currentMonth, formatDate, isMonth, monthLabel, today } from "@/lib/dates";
import { schema } from "@/lib/db";
import { Badge, Card, EmptyState, LinkButton, PlatformTag, ProgressBar, StatusBadge, cx, formatNumber, humanize } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { CreatorFilterChips, CreatorList, filterOutreach, type CreatorFilter } from "@/components/client-creators";
import { ViewsChart, type ViewsPoint } from "@/components/views-chart";
import { TaskRow, isOverdue } from "@/components/task-row";
import { isAdHocTask } from "@/lib/ops-tasks";
import type { Task } from "@/lib/schema";
import { generateChecklistAction, quickAddTaskAction, saveMetricsAction } from "../actions";
import { monthBounds } from "@/lib/integrations/time";
import { getOnboardingStatus } from "@/lib/ops-onboarding";
import { getCreatorStats } from "@/lib/ops-creator";
import { activeCollabLeads, noraUnfiledTasks, openCollabRequests } from "@/lib/data";
import { OnboardWelcome } from "@/components/onboard-welcome";
import { CollabLeadsCard, CollabRequestsCard, CreatorHeader, CreatorRow, CreatorStatsCard, DealsCard } from "@/components/creator-workspace-cards";
import { SavedRepliesCard } from "@/components/reply-links";
import { dealsCardData } from "@/lib/ops-deals";

export const dynamic = "force-dynamic";

const FILTERS: CreatorFilter[] = ["all", "month", "active", "posted"];

function externalUrl(u: string) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; creators?: string; welcome?: string; lead?: string }>;
}) {
  const [{ id }, sp, user] = await Promise.all([params, searchParams, requireUser()]);
  const now = currentMonth();
  const month = isMonth(sp.month) ? sp.month : now;
  const filter: CreatorFilter = FILTERS.includes(sp.creators as CreatorFilter) ? (sp.creators as CreatorFilter) : "all";

  const [data, onboarding] = await Promise.all([getClientMonth(id, month), getOnboardingStatus(id)]);
  if (!data) notFound();
  // Nora's own workspace gets its own layout: collabs, her plan & tasks, stats. No reviews or creator outreach.
  if (data.client.kind === "creator") return <CreatorWorkspace data={data} month={month} now={now} />;
  const { client, plan, outreach, metrics, posts } = data;
  // While Getting started is showing, its steps live in that card rather than twice on the page.
  const openTasks = onboarding.active ? data.openTasks.filter((t) => t.tag !== "onboarding") : data.openTasks;

  // Month edges in the app timezone (America/New_York), matching the calendar and Instagram insights.
  const { start: monthStart, end: nextStart } = monthBounds(month);
  const mon = monthLabel(month, "long");
  const prevMonth = addMonths(month, -1);

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    if (month !== now) p.set("month", month);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    const s = p.toString();
    return `/clients/${client.id}${s ? `?${s}` : ""}`;
  };

  /* plan */
  const needsChecklist = plan.some((p) => p.planned < Math.max(1, p.target));

  /* creators */
  const counts = Object.fromEntries(FILTERS.map((f) => [f, filterOutreach(outreach, f, monthStart, nextStart).length])) as Record<CreatorFilter, number>;
  const shownCreators = filterOutreach(outreach, filter, monthStart, nextStart);

  /* views */
  const points: ViewsPoint[] = metrics.map((m) => ({
    month: m.month,
    label: monthLabel(m.month, "short"),
    longLabel: monthLabel(m.month, "long"),
    instagram: m.instagram?.views ?? null,
    tiktok: m.tiktok?.views ?? null,
  }));
  const cur = metrics[metrics.length - 1];
  const prev = metrics[metrics.length - 2];

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted">
              <Link href="/clients" className="hover:underline">Businesses</Link>
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {client.name}
              {client.archived && <Badge className="ml-2 align-middle">Archived</Badge>}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {client.location && <span className="text-muted">{client.location}</span>}
              {client.instagramHandle && (
                <a href={`https://instagram.com/${client.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-ig hover:underline">
                  IG @{client.instagramHandle}
                </a>
              )}
              {client.tiktokHandle && (
                <a href={`https://www.tiktok.com/@${client.tiktokHandle}`} target="_blank" rel="noopener noreferrer" className="text-tt hover:underline">
                  TikTok @{client.tiktokHandle}
                </a>
              )}
              {client.website && (
                <a href={externalUrl(client.website)} target="_blank" rel="noopener noreferrer" className="max-w-full truncate text-muted hover:underline">
                  {client.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
                </a>
              )}
              {!client.instagramHandle && !client.tiktokHandle && (
                <Link href={`/clients/${client.id}/settings`} className="text-accent hover:underline">Add social handles</Link>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 self-start">
            <LinkButton href={`/reports?client=${client.id}`} size="sm">Reports</LinkButton>
            <LinkButton href={`/clients/${client.id}/settings`} size="sm">
              Settings &amp; plan
            </LinkButton>
          </div>
        </div>
        <MonthPicker month={month} current={now} />
      </div>

      {sp.welcome === "1" && <OnboardWelcome name={client.name} fromLead={sp.lead === "1"} />}

      <div className="grid gap-6">
        {onboarding.active && (
          <Card
            title="Getting started"
            actions={<span className="text-xs font-medium tabular-nums text-muted">{onboarding.done} of {onboarding.total} done</span>}
          >
            <p className="-mt-1 mb-3 text-sm text-muted">A few one-time steps to get {client.name} set up. This card disappears when they&apos;re all ticked off.</p>
            <ProgressBar value={onboarding.done} max={onboarding.total} />
            <ul className="mt-2 divide-y divide-border">
              {onboarding.tasks.map((t) => (
                <li key={t.id}>
                  <TaskRow task={t} clientName={client.name} showClient={false} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* a. Plan */}
          <PlanCard clientId={client.id} plan={plan} month={month} now={now} />

          {/* b. Outstanding */}
          <OutstandingCard
            clientId={client.id}
            clientName={client.name}
            openTasks={openTasks}
            month={month}
            now={now}
            pendingDrafts={data.pendingDrafts}
            unrepliedReviews={data.unrepliedReviews}
            needsChecklist={needsChecklist && plan.length > 0}
            defaultAssignee={assigneeFor(user)}
          />
        </div>

        {/* c. Creators */}
        <section id="creators" className="scroll-mt-4">
          <Card
            title={
              <>
                Creators <span className="font-normal text-muted">· {data.contactedThisMonth} contacted in {monthLabel(month, "short")}</span>
              </>
            }
            actions={<LinkButton href={`/creators/new?client=${client.id}`} size="sm" variant="primary">Add creator</LinkButton>}
          >
            {outreach.length === 0 ? (
              <EmptyState title="No creator outreach yet">
                <Link href={`/creators/new?client=${client.id}`} className="text-accent hover:underline">Add a creator</Link>, or drop an ask for Claude to find local food creators for {client.name}.
              </EmptyState>
            ) : (
              <>
                <CreatorFilterChips current={filter} counts={counts} href={(f) => `${qs({ creators: f === "all" ? undefined : f })}#creators`} />
                <div className="mt-2">
                  <CreatorList
                    rows={shownCreators}
                    emptyHint={filter === "month" ? `No one was contacted in ${mon}.` : filter === "posted" ? "No creator posts yet." : "No creators in active conversations."}
                  />
                </div>
              </>
            )}
          </Card>
        </section>

        {/* d. Views */}
        <section id="views" className="scroll-mt-4">
          <Card title="Views (impressions)">
            <p className="-mt-1 mb-4 text-xs text-muted">
              Instagram replaced “impressions” with “views” in 2025, so this is the same number under its new name. TikTok reports video views.
            </p>

            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <MetricTile label={`Instagram · ${monthLabel(month, "short")}`} value={cur?.instagram?.views ?? null} prev={prev?.instagram?.views ?? null} prevLabel={monthLabel(prevMonth, "short")} synced={cur?.instagram?.source === "api"} />
              <MetricTile label={`TikTok · ${monthLabel(month, "short")}`} value={cur?.tiktok?.views ?? null} prev={prev?.tiktok?.views ?? null} prevLabel={monthLabel(prevMonth, "short")} synced={cur?.tiktok?.source === "api"} />
              <MetricTile
                label="Total views"
                value={cur?.instagram?.views == null && cur?.tiktok?.views == null ? null : (cur?.instagram?.views ?? 0) + (cur?.tiktok?.views ?? 0)}
                prev={prev?.instagram?.views == null && prev?.tiktok?.views == null ? null : (prev?.instagram?.views ?? 0) + (prev?.tiktok?.views ?? 0)}
                prevLabel={monthLabel(prevMonth, "short")}
              />
            </div>

            <ViewsChart points={points} title={`${client.name} monthly views, ${monthLabel(metrics[0].month)} to ${mon}`} />

            <details className="mt-5 rounded-lg border border-border" open={!cur?.instagram && !cur?.tiktok}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium pointer-coarse:py-3">Enter or edit {mon} numbers</summary>
              <ActionForm action={saveMetricsAction.bind(null, client.id, month)} className="border-t border-border p-3" ariaLabel={`Numbers for ${mon}`}>
                <div className="grid gap-4 md:grid-cols-2">
                  {(["instagram", "tiktok"] as const).map((p) => {
                    const row = cur?.[p] ?? null;
                    return (
                      <fieldset key={p} className="min-w-0">
                        <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
                          <PlatformTag platform={p} />
                          {row?.source === "api" && <Badge tone="info">Synced from {p === "instagram" ? "Instagram" : "TikTok"}</Badge>}
                        </legend>
                        {row && <input type="hidden" name={`${p}_present`} value="1" />}
                        <div className="grid grid-cols-2 gap-2">
                          {(["views", "reach", "followers", "engagements"] as const).map((f) => (
                            <div key={f}>
                              <label className="label" htmlFor={`m-${p}-${f}`}>{humanize(f)}</label>
                              <input
                                id={`m-${p}-${f}`}
                                name={`${p}_${f}`}
                                inputMode="numeric"
                                pattern="[0-9,\s]*"
                                defaultValue={row?.[f] ?? ""}
                                className="input tabular-nums"
                                autoComplete="off"
                              />
                            </div>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <SubmitButton size="sm">Save numbers</SubmitButton>
                  <p className="text-xs text-muted">Leave blank if you don&apos;t have it. Saving overwrites synced numbers for this month.</p>
                </div>
              </ActionForm>
            </details>
          </Card>
        </section>

        {/* e. Content */}
        <ContentCard clientId={client.id} posts={posts} month={month} />
      </div>
    </>
  );
}

/** One block of the Outstanding card: heading with a count, then rows. Tasks from earlier months get a "From Oct" badge. */
function OutstandingSection({ title, tasks, month, clientName }: { title: string; tasks: Task[]; month: string; clientName: string }) {
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  return (
    <section>
      <h3 className="mb-1 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
        <span className="font-normal normal-case tracking-normal tabular-nums">· {tasks.length}</span>
        {overdue > 0 && <span className="font-medium normal-case tracking-normal text-danger">{overdue} overdue</span>}
      </h3>
      <ul className="divide-y divide-border">
        {tasks.map((t) => (
          <li key={t.id} className={t.month < month ? "pt-3" : undefined}>
            {t.month < month && <Badge tone="warn" className="-mb-2">From {monthLabel(t.month, "short")}</Badge>}
            <TaskRow task={t} clientName={clientName} showClient={false} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MetricTile({ label, value, prev, prevLabel, synced }: { label: string; value: number | null; prev: number | null; prevLabel: string; synced?: boolean }) {
  let delta: React.ReactNode = <span className="text-muted">No {prevLabel} number to compare</span>;
  if (value != null && prev != null && prev > 0) {
    const pct = Math.round(((value - prev) / prev) * 100);
    const up = pct > 0;
    const flat = pct === 0;
    delta = (
      <span className={flat ? "text-muted" : up ? "text-ok" : "text-danger"}>
        <span aria-hidden>{flat ? "→" : up ? "↑" : "↓"}</span> {flat ? "Same as" : `${up ? "+" : ""}${pct}% vs`} {prevLabel}
      </span>
    );
  } else if (value == null) {
    delta = <span className="text-muted">Not entered yet</span>;
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
        {label}
        {synced && <Badge tone="info">Synced</Badge>}
      </p>
      <p className="mt-1 text-2xl font-semibold" title={value != null ? value.toLocaleString("en-US") : undefined}>
        {value == null ? "—" : formatNumber(value)}
      </p>
      <p className="mt-0.5 text-xs">{delta}</p>
    </div>
  );
}


function PlanCard({ clientId, plan, month, now }: { clientId: string; plan: ClientMonth["plan"]; month: string; now: string }) {
  const mon = monthLabel(month, "long");
  const needsChecklist = plan.some((p) => p.planned < Math.max(1, p.target));
  const totalTarget = plan.reduce((a, p) => a + p.target, 0);
  const totalDone = plan.reduce((a, p) => a + (p.target > 0 ? Math.min(p.done, p.target) : 0), 0);
  return (
    <Card
      title={`${month === now ? "This month's" : `${mon}'s`} plan`}
      actions={<Link href={`/clients/${clientId}/settings#plan`} className="text-xs text-accent hover:underline">Edit plan</Link>}
    >
      {plan.length === 0 ? (
        <EmptyState title="No monthly plan yet">
          <Link href={`/clients/${clientId}/settings#plan`} className="text-accent hover:underline">Set what you deliver each month</Link> (posts, stories, videos, outreach…).
        </EmptyState>
      ) : (
        <>
          {totalTarget > 0 && (
            <p className="mb-3 text-sm">
              <span className="font-semibold tabular-nums">{totalDone} of {totalTarget}</span>{" "}
              <span className="text-muted">planned items done</span>
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {plan.map((p) => (
              <li key={p.deliverable.id}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.deliverable.title}</p>
                    <PlatformTag platform={p.deliverable.platform} />
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">
                    {p.target > 0 ? (
                      <><span className="font-semibold">{p.done}</span><span className="text-muted"> / {p.target}</span></>
                    ) : (
                      <span className="text-muted"><span className="font-semibold text-text">{p.done}</span> done · as needed</span>
                    )}
                  </p>
                </div>
                <ProgressBar value={p.done} max={p.target} />
              </li>
            ))}
          </ul>
          {needsChecklist && (
            <form action={generateChecklistAction.bind(null, clientId, month)} className="mt-4 rounded-lg bg-surface-2 p-3">
              <p className="mb-2 text-xs text-muted">
                Turn the plan into tasks for {mon} so progress can be tracked. Only adds what&apos;s missing.
              </p>
              <SubmitButton size="sm" pendingLabel="Creating…">Create {month === now ? "this month's" : `${monthLabel(month, "short")}`} checklist</SubmitButton>
            </form>
          )}
        </>
      )}
    </Card>
  );
}

function OutstandingCard({
  clientId,
  clientName,
  openTasks,
  month,
  now,
  pendingDrafts,
  unrepliedReviews,
  needsChecklist,
  defaultAssignee,
  placeholder = "e.g. Film new menu reel",
}: {
  clientId: string;
  clientName: string;
  openTasks: Task[];
  month: string;
  now: string;
  pendingDrafts: number;
  unrepliedReviews: number;
  needsChecklist: boolean;
  defaultAssignee: string;
  placeholder?: string;
}) {
  const mon = monthLabel(month, "long");
  /* outstanding: the plan checklist vs one-off (ad hoc) work. Ad hoc goes first when any of it is overdue. */
  const adHoc = openTasks.filter(isAdHocTask);
  const checklist = openTasks.filter((t) => !isAdHocTask(t));
  const adHocFirst = adHoc.some((t) => isOverdue(t));
  const sections = [
    { key: "checklist", title: `${month === now ? "This month's" : `${mon}'s`} checklist`, tasks: checklist },
    { key: "adhoc", title: "Ad hoc", tasks: adHoc },
  ];
  if (adHocFirst) sections.reverse();
  return (
    <Card title={`Outstanding${openTasks.length ? ` (${openTasks.length})` : ""}`} padded={false}>
      {(pendingDrafts > 0 || unrepliedReviews > 0) && (
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          {pendingDrafts > 0 && (
            <Link href={`/review?client=${clientId}`} className="inline-flex items-center rounded-full bg-warn-soft px-3 py-1 text-xs font-medium text-warn hover:opacity-90 pointer-coarse:min-h-11">
              {pendingDrafts} draft{pendingDrafts === 1 ? "" : "s"} waiting for review →
            </Link>
          )}
          {unrepliedReviews > 0 && (
            <Link href={`/reviews?client=${clientId}`} className="inline-flex items-center rounded-full bg-info-soft px-3 py-1 text-xs font-medium text-info hover:opacity-90 pointer-coarse:min-h-11">
              {unrepliedReviews} Google review{unrepliedReviews === 1 ? "" : "s"} without a reply →
            </Link>
          )}
        </div>
      )}

      <div className="px-4 py-3">
        {openTasks.length === 0 ? (
          <EmptyState title="Nothing outstanding">
            {needsChecklist ? "Create the checklist from the plan, or add a task below." : "All caught up. Add a task below if something comes up."}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            {sections.filter((sec) => sec.tasks.length > 0).map((sec) => (
              <OutstandingSection key={sec.key} title={sec.title} tasks={sec.tasks} month={month} clientName={clientName} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 py-3">
        <ActionForm action={quickAddTaskAction.bind(null, clientId, month)} resetOnSuccess ariaLabel="Quick add task">
          <label className="label" htmlFor="qa-title">Add an ad hoc task for {mon}</label>
          <div className="flex gap-2">
            <input id="qa-title" name="title" required className="input" placeholder={placeholder} autoComplete="off" />
            <SubmitButton size="sm" pendingLabel="Adding…" className="shrink-0">Add</SubmitButton>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label className="sr-only" htmlFor="qa-assignee">Assignee</label>
              <select id="qa-assignee" name="assignee" defaultValue={defaultAssignee} className="input">
                {schema.ASSIGNEES.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
              </select>
            </div>
            <div>
              <label className="sr-only" htmlFor="qa-platform">Platform</label>
              <select id="qa-platform" name="platform" defaultValue="" className="input">
                <option value="">Any platform</option>
                {schema.PLATFORMS.map((p) => <option key={p} value={p}>{p === "tiktok" ? "TikTok" : humanize(p)}</option>)}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="sr-only" htmlFor="qa-due">Due date</label>
              <input id="qa-due" name="dueDate" type="date" className="input" aria-label="Due date" />
            </div>
          </div>
        </ActionForm>
      </div>
    </Card>
  );
}

function ContentCard({ clientId, posts, month }: { clientId: string; posts: ClientMonth["posts"]; month: string }) {
  const mon = monthLabel(month, "long");
  return (
    <Card
      title={`Content in ${mon}`}
      actions={<Link href={`/calendar?client=${clientId}&month=${month}`} className="text-xs text-accent hover:underline">Open calendar</Link>}
    >
      {posts.length === 0 ? (
        <EmptyState title="Nothing scheduled this month">
          <Link href={`/calendar?client=${clientId}&month=${month}`} className="text-accent hover:underline">Plan posts on the calendar</Link>, or ask Claude to draft a month of captions.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/calendar?client=${clientId}&month=${month}`} className="flex flex-col gap-1 py-2.5 hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4 -mx-2 px-2 rounded-md">
                <span className="w-24 shrink-0 text-sm tabular-nums text-muted">{formatDate(p.scheduledFor)}</span>
                <span className="flex w-36 shrink-0 items-center gap-2">
                  <PlatformTag platform={p.platform} />
                  <span className="text-xs text-muted">{humanize(p.format)}</span>
                </span>
                <span className={cx("min-w-0 flex-1 truncate text-sm", !p.caption && "italic text-muted")}>{p.caption ? p.caption : "No caption yet"}</span>
                <span className="shrink-0"><StatusBadge status={p.status} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ Nora's own section */

/**
 * /clients/noraeatsgood: Nora's creator business in one place. Top to bottom: collab requests,
 * this month's plan + her own tasks, stats, collab leads, content. Same plan/task/content cards as a business.
 */
async function CreatorWorkspace({ data, month, now }: { data: ClientMonth; month: string; now: string }) {
  const { client, plan, posts } = data;
  const [collabs, stats, leads, unfiled, deals] = await Promise.all([
    openCollabRequests(5),
    getCreatorStats({ days: 31 }),
    activeCollabLeads(5),
    noraUnfiledTasks(month),
    dealsCardData(),
  ]);
  // Her tasks: everything filed under her workspace, plus anything assigned to her with no business attached.
  const seen = new Set(data.openTasks.map((t) => t.id));
  const tasks = [...data.openTasks, ...unfiled.filter((t) => !seen.has(t.id))];
  const needsChecklist = plan.some((p) => p.planned < Math.max(1, p.target));

  return (
    <>
      <CreatorHeader client={client} />
      <div className="grid gap-6">
        <CreatorRow>
          <CollabRequestsCard newCount={collabs.newCount} reviewingCount={collabs.reviewingCount} latest={collabs.latest} />
          <DealsCard data={deals} />
        </CreatorRow>

        <CreatorRow>
          <PlanCard clientId={client.id} plan={plan} month={month} now={now} />
          <OutstandingCard
            clientId={client.id}
            clientName={client.name}
            openTasks={tasks}
            month={month}
            now={now}
            pendingDrafts={data.pendingDrafts}
            unrepliedReviews={0}
            needsChecklist={needsChecklist && plan.length > 0}
            defaultAssignee="nora"
            placeholder="e.g. Edit the ramen reel"
          />
        </CreatorRow>

        <CreatorRow>
          <CreatorStatsCard platforms={[stats.platforms.instagram, stats.platforms.tiktok]} />
          <CollabLeadsCard rows={leads.rows} total={leads.total} today={today()} />
        </CreatorRow>

        <ContentCard clientId={client.id} posts={posts} month={month} />

        <SavedRepliesCard />
      </div>
    </>
  );
}
