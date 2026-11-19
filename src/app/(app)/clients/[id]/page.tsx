import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, assigneeFor, seesDrafts } from "@/lib/auth";
import { getClientMonth, type ClientMonth } from "@/lib/reports";
import { addMonths, currentMonth, formatDate, isMonth, monthLabel, today } from "@/lib/dates";
import { schema } from "@/lib/db";
import { Card, EmptyState, LinkButton, PlatformTag, ProgressBar, Stat, Status, StatusBadge, Tag, cx, formatNumber, humanize } from "@/components/ui";
import { MonthPicker } from "@/components/month-picker";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { CreatorFilterChips, CreatorList, filterOutreach, type CreatorFilter } from "@/components/client-creators";
import { ViewsChart, type ViewsPoint } from "@/components/views-chart";
import { TaskRow, isOverdue } from "@/components/task-row";
import type { Task } from "@/lib/schema";
import { generateChecklistAction, quickAddTaskAction, saveMetricsAction } from "../actions";
import { monthBounds } from "@/lib/integrations/time";
import { getOnboardingStatus } from "@/lib/ops-onboarding";
import { getCreatorStats } from "@/lib/ops-creator";
import { activeCollabLeads, noraUnfiledTasks, openCollabRequests } from "@/lib/data";
import { OnboardWelcome } from "@/components/onboard-welcome";
import { CollabLeadsCard, CollabRequestsCard, CreatorHeader, CreatorStatsCard, DealsCard } from "@/components/creator-workspace-cards";
import { SavedRepliesCard } from "@/components/reply-links";
import { dealsCardData } from "@/lib/ops-deals";
import { ClientIntakeCard } from "@/components/client-intake-card";
import { PASSWORD_WARNING, hasSecret } from "@/lib/credential-guard";
import { ClientGoogleSync } from "@/components/google-sync-status";
import { groupPlanTasks, isPlanTask, type PlanGroup } from "@/lib/plan-groups";
import { PlanTaskGroups } from "@/components/plan-task-groups";
import { LaunchCard } from "@/components/launch-card";
import { ClientDropCard } from "@/components/client-drop-card";
import { LAUNCH_TAG, launchInfo, planHoldLine } from "@/lib/launch";

export const dynamic = "force-dynamic";

const FILTERS: CreatorFilter[] = ["all", "month", "active", "posted"];

function externalUrl(u: string) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

const platformName = (p: string) => (p === "tiktok" ? "TikTok" : humanize(p));

function Chevron({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
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
  if (data.client.kind === "creator") return <CreatorWorkspace data={data} month={month} now={now} simple={assigneeFor(user) === "nora"} />;
  const { client, plan, outreach, metrics, posts } = data;
  // Drafts are Cameron's side; Nora doesn't see draft counts here either.
  const draftsToReview = seesDrafts(user) ? data.pendingDrafts : 0;
  // While Getting started is showing, its steps live in that card rather than twice on the page.
  // Not open yet: the launch steps live in the Launch checklist card, and the monthly plan waits for opening day.
  const launch = launchInfo(client);
  const openTasks = data.openTasks.filter((t) => !(onboarding.active && t.tag === "onboarding") && !(launch.prelaunch && t.tag === LAUNCH_TAG));

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

  /* plan: what is still open sits in Outstanding's checklist (one collapsible row per plan item), so the plan section
     only lists the items that have nothing left there. Each item's progress shows once on the page. */
  const planGroups = await groupPlanTasks(openTasks.filter(isPlanTask));
  const inChecklist = new Set(planGroups.filter((g) => g.month === month).map((g) => g.deliverableId));

  return (
    <>
      {/* Page head: the way back, the name, where they are and the Google status, then the month and the jump links. */}
      <header className="page-head">
        <p className="crumb">
          <Link href="/clients">Businesses</Link>
        </p>
        <div className="head-row">
          <h1 className="display">
            {client.name}
            {client.archived && <Tag>Inactive</Tag>}
            {launch.prelaunch && <Status tone="info" className="biz-flag">Pre-launch</Status>}
          </h1>
          <div className="head-actions">
            <LinkButton href={`/reports?client=${client.id}`} size="sm">Reports</LinkButton>
            <LinkButton href={`/clients/${client.id}/settings`} size="sm">
              Settings &amp; plan
            </LinkButton>
          </div>
        </div>
        <p className="sub biz-meta">
          {client.location && <span>{client.location}</span>}
          {client.instagramHandle && (
            <a href={`https://instagram.com/${client.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="status is-ig">
              IG @{client.instagramHandle}
            </a>
          )}
          {client.tiktokHandle && (
            <a href={`https://www.tiktok.com/@${client.tiktokHandle}`} target="_blank" rel="noopener noreferrer" className="status is-tt">
              TikTok @{client.tiktokHandle}
            </a>
          )}
          {client.website && (
            <a href={externalUrl(client.website)} target="_blank" rel="noopener noreferrer">
              {client.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
            </a>
          )}
          {!client.instagramHandle && !client.tiktokHandle && (
            <Link href={`/clients/${client.id}/settings`} className="link">Add social handles</Link>
          )}
        </p>
        {/* What the last Google review sync found for THIS business (not the account-wide "Connected"). */}
        <ClientGoogleSync client={client} prefix="Google reviews" className="mt-1" />
        {/* Active / inactive lives in Settings & plan; here only an inactive business says so (the tag above). */}
        <div className="biz-controls">
          <MonthPicker month={month} current={now} />
        </div>
        <AtAGlance
          items={[
            {
              href: "#outstanding",
              label: openTasks.length === 0 ? "Nothing open" : `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`,
              tone: openTasks.some((t) => isOverdue(t)) ? "danger" : openTasks.length ? "warn" : "ok",
            },
            ...(plan.length > 0 && !launch.planOnHold
              ? [{ href: "#plan", label: `Plan ${plan.reduce((a, p) => a + (p.target > 0 ? Math.min(p.done, p.target) : 0), 0)}/${plan.reduce((a, p) => a + p.target, 0)}`, tone: "neutral" as const }]
              : []),
            ...(draftsToReview > 0 ? [{ href: `/review?client=${client.id}`, label: `${draftsToReview} to review`, tone: "warn" as const }] : []),
            ...(data.unrepliedReviews > 0 ? [{ href: `/reviews?client=${client.id}`, label: `${data.unrepliedReviews} review${data.unrepliedReviews === 1 ? "" : "s"} to reply`, tone: "warn" as const }] : []),
            { href: "#creators", label: `Creators ${outreach.length}`, tone: "neutral" },
            { href: "#views", label: "Views", tone: "neutral" },
            { href: "#content", label: `Content ${posts.length}`, tone: "neutral" },
          ]}
        />
      </header>

      {hasSecret(client.notes) && (
        <div role="alert" className="notice mb-7">
          <span className="status is-warn">{PASSWORD_WARNING}</span>
          <Link href={`/clients/${client.id}/settings`} className="link tap-target shrink-0">
            Open Settings
          </Link>
        </div>
      )}

      {sp.welcome === "1" && <OnboardWelcome name={client.name} fromLead={sp.lead === "1"} />}

      {/* Four groups, in the order a phone shows them: what needs doing, the plan, the reference sections, then the
          rarely touched set-up. On a wide screen the plan sits beside Outstanding; the rest runs the full width. */}
      <div className="cols biz-cols is-biz">
        <div className="biz-col">
          {onboarding.active && (
            <Card title="Getting started" padded={false}>
              <p className="sec-note">A few one-time steps to get {client.name} set up. This section disappears when they&apos;re all ticked off.</p>
              <div className="biz-progress">
                <ProgressBar value={onboarding.done} max={onboarding.total} />
                <span className="meta num"><b>{onboarding.done}</b> of {onboarding.total} done</span>
              </div>
              <ul className="list is-ruled border-b-0">
                {onboarding.tasks.map((t) => (
                  <li key={t.id}>
                    <TaskRow task={t} clientName={client.name} showClient={false} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <LaunchCard client={client} />

          {/* The onboarding form matters while a business is being set up; after that it moves to the set-up group. */}
          {onboarding.active && <ClientIntakeCard clientId={client.id} clientName={client.name} />}

          {/* a. Outstanding first: it's what needs doing. */}
          <div id="outstanding" className="scroll-mt-4">
            <OutstandingCard
              clientId={client.id}
              clientName={client.name}
              openTasks={openTasks}
              planGroups={planGroups}
              month={month}
              now={now}
              pendingDrafts={draftsToReview}
              unrepliedReviews={data.unrepliedReviews}
              needsChecklist={needsChecklist && plan.length > 0 && !launch.planOnHold}
              defaultAssignee={assigneeFor(user)}
            />
          </div>
        </div>

        <div className="biz-side">
          {/* b. Plan */}
          <div id="plan" className="scroll-mt-4">
            <PlanCard clientId={client.id} plan={plan} month={month} now={now} inChecklist={inChecklist} holdNote={planHoldLine(client.name, launch) || undefined} />
          </div>
        </div>

        <div className="biz-col is-wide">
          {/* c. Creators */}
          <section id="creators" className="scroll-mt-4">
            <Card
              padded={false}
              title={
                <span className="title-stack">
                  Creators <span className="meta">{data.contactedThisMonth} contacted in {monthLabel(month, "short")}</span>
                </span>
              }
              actions={
                <LinkButton href={`/creators/new?client=${client.id}`} size="sm" className="shrink-0">
                  Add creator
                </LinkButton>
              }
            >
              {outreach.length === 0 ? (
                <EmptyState title="No creator outreach yet">
                  <Link href={`/creators/new?client=${client.id}`} className="link">Add a creator</Link>, or drop an ask for Claude to find local food creators for {client.name}.
                </EmptyState>
              ) : (
                <>
                  <CreatorFilterChips current={filter} counts={counts} href={(f) => `${qs({ creators: f === "all" ? undefined : f })}#creators`} />
                  <CreatorList
                    rows={shownCreators}
                    emptyHint={filter === "month" ? `No one was contacted in ${mon}.` : filter === "posted" ? "No creator posts yet." : "No creators in active conversations."}
                  />
                </>
              )}
            </Card>
          </section>

          {/* d. Views */}
          <section id="views" className="scroll-mt-4">
            <Card title="Views (impressions)" padded={false}>
              <p className="sec-note">
                Instagram replaced “impressions” with “views” in 2025, so this is the same number under its new name. TikTok reports video views.
              </p>

              <div className="figures pb-5 pt-2">
                <MetricFigure label={`Instagram · ${monthLabel(month, "short")}`} value={cur?.instagram?.views ?? null} prev={prev?.instagram?.views ?? null} prevLabel={monthLabel(prevMonth, "short")} synced={cur?.instagram?.source === "api"} />
                <MetricFigure label={`TikTok · ${monthLabel(month, "short")}`} value={cur?.tiktok?.views ?? null} prev={prev?.tiktok?.views ?? null} prevLabel={monthLabel(prevMonth, "short")} synced={cur?.tiktok?.source === "api"} />
                <MetricFigure
                  label="Total views"
                  value={cur?.instagram?.views == null && cur?.tiktok?.views == null ? null : (cur?.instagram?.views ?? 0) + (cur?.tiktok?.views ?? 0)}
                  prev={prev?.instagram?.views == null && prev?.tiktok?.views == null ? null : (prev?.instagram?.views ?? 0) + (prev?.tiktok?.views ?? 0)}
                  prevLabel={monthLabel(prevMonth, "short")}
                />
              </div>

              <ViewsChart points={points} title={`${client.name} monthly views, ${monthLabel(metrics[0].month)} to ${mon}`} />

              <details className="biz-disc mt-3" open={!cur?.instagram && !cur?.tiktok}>
                <summary>
                  Enter or edit {mon} numbers
                  <Chevron />
                </summary>
                <ActionForm action={saveMetricsAction.bind(null, client.id, month)} className="pb-2 pt-1" ariaLabel={`Numbers for ${mon}`}>
                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    {(["instagram", "tiktok"] as const).map((p) => {
                      const row = cur?.[p] ?? null;
                      return (
                        <fieldset key={p} className="min-w-0">
                          <legend className="mb-2 flex items-baseline gap-2 font-medium">
                            <PlatformTag platform={p} inherit />
                            {row?.source === "api" && <Tag>Synced from {p === "instagram" ? "Instagram" : "TikTok"}</Tag>}
                          </legend>
                          {row && <input type="hidden" name={`${p}_present`} value="1" />}
                          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
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
                  <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
                    <SubmitButton>Save numbers</SubmitButton>
                    <p className="meta">Leave blank if you don&apos;t have it. Saving overwrites synced numbers for this month.</p>
                  </div>
                </ActionForm>
              </details>
            </Card>
          </section>

          {/* e. Content */}
          <section id="content" className="scroll-mt-4">
            <ContentCard clientId={client.id} posts={posts} month={month} />
          </section>
        </div>

        <div className="is-wide biz-setup">
          {/* f. Set-up, rarely touched: the onboarding form (once set up) and the owner's drop link. */}
          {!onboarding.active && <ClientIntakeCard clientId={client.id} clientName={client.name} />}
          <ClientDropCard clientId={client.id} clientName={client.name} inactive={client.archived} />
        </div>
      </div>
    </>
  );
}

type GlanceTone = "neutral" | "ok" | "warn" | "danger";

/**
 * One quiet line of jump links: what needs doing on this business, and a shortcut to each section. A dot marks the
 * ones that need someone (overdue in danger, waiting in warn); the rest are plain muted words. Scrolls sideways on
 * phones instead of wrapping into a block.
 */
function AtAGlance({ items }: { items: { href: string; label: string; tone: GlanceTone }[] }) {
  return (
    <nav aria-label="On this page" className="biz-glance overflow-x-auto">
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={i.tone === "neutral" ? undefined : `status is-${i.tone}`}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One block of Outstanding: a caps label with a count, then rows. Tasks from earlier months carry a "From Oct" tag. */
function OutstandingSection({ title, tasks, month, clientName }: { title: string; tasks: Task[]; month: string; clientName: string }) {
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  return (
    <section>
      <h3 className="biz-group eyebrow">
        {title}
        <span>· {tasks.length}</span>
        {overdue > 0 && <span className="over">{overdue} overdue</span>}
      </h3>
      <ul className="list">
        {tasks.map((t) => (
          <li key={t.id}>
            {t.month < month && <p className="biz-from"><Tag bare>From {monthLabel(t.month, "short")}</Tag></p>}
            <TaskRow task={t} clientName={clientName} showClient={false} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A figure for one month: caps label, the number in the serif, how it compares with the month before. No box. */
function MetricFigure({ label, value, prev, prevLabel, synced }: { label: string; value: number | null; prev: number | null; prevLabel: string; synced?: boolean }) {
  let delta = `No ${prevLabel} number to compare`;
  if (value != null && prev != null && prev > 0) {
    const pct = Math.round(((value - prev) / prev) * 100);
    delta = pct === 0 ? `Same as ${prevLabel}` : `${pct > 0 ? "+" : ""}${pct}% vs ${prevLabel}`;
  } else if (value == null) {
    delta = "Not entered yet";
  }
  return (
    <Stat
      label={<>{label}{synced && <Tag>Synced</Tag>}</>}
      value={<span title={value != null ? value.toLocaleString("en-US") : undefined}>{value == null ? "—" : formatNumber(value)}</span>}
      hint={delta}
    />
  );
}

/**
 * The month's plan. `inChecklist`: plan items that still have open tasks in Outstanding's checklist, where each one is
 * a collapsible row with its "3 of 8"; they are left out here so the page shows each item's progress once. What stays:
 * the total, the items with nothing left on the checklist, and the way to make the checklist or edit the plan.
 */
function PlanCard({
  clientId, plan, month, now, holdNote, inChecklist = new Set<string>(),
}: {
  clientId: string; plan: ClientMonth["plan"]; month: string; now: string;
  /** Pre-launch: why no checklist is created yet. */
  holdNote?: string;
  inChecklist?: Set<string>;
}) {
  const mon = monthLabel(month, "long");
  const needsChecklist = plan.some((p) => p.planned < Math.max(1, p.target));
  const totalTarget = plan.reduce((a, p) => a + p.target, 0);
  const totalDone = plan.reduce((a, p) => a + (p.target > 0 ? Math.min(p.done, p.target) : 0), 0);
  const rows = plan.filter((p) => !inChecklist.has(p.deliverable.id));
  const hidden = plan.length - rows.length;
  return (
    <Card
      padded={false}
      title={`${month === now ? "This month’s" : `${mon}’s`} plan`}
      actions={<Link href={`/clients/${clientId}/settings#plan`} className="link-quiet">Edit plan</Link>}
    >
      {plan.length === 0 ? (
        <EmptyState title="No monthly plan yet">
          <Link href={`/clients/${clientId}/settings#plan`} className="link">Set what you deliver each month</Link> (posts, stories, videos, outreach…).
        </EmptyState>
      ) : (
        <>
          {totalTarget > 0 && (
            <div className="biz-progress pt-1">
              <ProgressBar value={totalDone} max={totalTarget} />
              <span className="meta num"><b>{totalDone} of {totalTarget}</b> planned items done</span>
            </div>
          )}
          {hidden > 0 && (
            <p className="sec-note">
              {rows.length === 0 ? "Each item’s progress is" : "Items with tasks left are"} on the checklist under Outstanding.
            </p>
          )}
          {rows.length > 0 && (
            <ul className="list is-ruled border-b-0">
              {rows.map((p) => {
                const platform = p.deliverable.platform;
                // The platform is only spelled out when the item's own name doesn't already say it.
                const named = !platform || platform === "other" || p.deliverable.title.toLowerCase().includes(platformName(platform).toLowerCase());
                return (
                  <li key={p.deliverable.id} className="row plan-row">
                    <span className="row-title">
                      {p.deliverable.title}
                      {!named && <PlatformTag platform={platform} className="meta" />}
                    </span>
                    {p.target > 0 ? (
                      <>
                        <ProgressBar value={p.done} max={p.target} />
                        <span className="n num"><b>{p.done}</b> <span>of {p.target}</span></span>
                      </>
                    ) : (
                      <span className="n num meta"><b>{p.done}</b> done · as needed</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {holdNote && (
            <p className="notice">
              <span className="status is-info">{holdNote}</span>
            </p>
          )}
          {needsChecklist && !holdNote && (
            <form action={generateChecklistAction.bind(null, clientId, month)} className="notice items-center">
              <p className="meta min-w-0 flex-1 basis-48 whitespace-normal">
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

async function OutstandingCard({
  clientId,
  clientName,
  openTasks,
  planGroups: groupsIn,
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
  /** The plan tasks in `openTasks`, already grouped (the page needs them too); grouped here when left out. */
  planGroups?: PlanGroup[];
  month: string;
  now: string;
  pendingDrafts: number;
  unrepliedReviews: number;
  needsChecklist: boolean;
  defaultAssignee: string;
  placeholder?: string;
}) {
  const mon = monthLabel(month, "long");
  /*
   * Outstanding: real (ad hoc) tasks are listed as they are, on top. The monthly plan's slots sit underneath,
   * condensed to one collapsible row per plan item ("Instagram feed posts · 3 of 8 ▸") so they can't bury them.
   */
  const real = openTasks.filter((t) => !isPlanTask(t));
  const planTasks = openTasks.filter(isPlanTask);
  const planGroups: PlanGroup[] = groupsIn ?? (await groupPlanTasks(planTasks));
  const planOverdue = planTasks.filter((t) => isOverdue(t)).length;
  return (
    <Card
      padded={false}
      title={
        <>
          Outstanding{openTasks.length > 0 && <> <span className="meta num">{openTasks.length} open</span></>}
        </>
      }
    >
      {(pendingDrafts > 0 || unrepliedReviews > 0) && (
        <ul className="list is-ruled biz-queue">
          {pendingDrafts > 0 && (
            <li>
              <Link href={`/review?client=${clientId}`} className="row">
                <span className="status is-warn row-title is-plain">{pendingDrafts} draft{pendingDrafts === 1 ? "" : "s"} waiting for review</span>
                <Chevron className="chev" />
              </Link>
            </li>
          )}
          {unrepliedReviews > 0 && (
            <li>
              <Link href={`/reviews?client=${clientId}`} className="row">
                <span className="status is-info row-title is-plain">{unrepliedReviews} Google review{unrepliedReviews === 1 ? "" : "s"} without a reply</span>
                <Chevron className="chev" />
              </Link>
            </li>
          )}
        </ul>
      )}

      {openTasks.length === 0 ? (
        <EmptyState title="Nothing outstanding">
          {needsChecklist ? "Create the checklist from the plan, or add a task below." : "All caught up. Add a task below if something comes up."}
        </EmptyState>
      ) : (
        <>
          {real.length > 0 && <OutstandingSection title="Ad hoc" tasks={real} month={month} clientName={clientName} />}
          {planGroups.length > 0 && (
            <section>
              <h3 className="biz-group eyebrow">
                {month === now ? "This month's" : `${mon}'s`} checklist
                <span>· {planTasks.length} left</span>
                {planOverdue > 0 && <span className="over">{planOverdue} overdue</span>}
              </h3>
              <div className="biz-checklist">
                <PlanTaskGroups groups={planGroups} month={month} />
              </div>
            </section>
          )}
        </>
      )}

      <ActionForm action={quickAddTaskAction.bind(null, clientId, month)} resetOnSuccess ariaLabel="Quick add task" className="biz-add">
        <label className="label" htmlFor="qa-title">Add a task for {mon}</label>
        <div className="flex gap-2">
          <input id="qa-title" name="title" required className="input" placeholder={placeholder} autoComplete="off" />
          <SubmitButton pendingLabel="Adding…" className="shrink-0">Add</SubmitButton>
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
              {schema.PLATFORMS.map((p) => <option key={p} value={p}>{platformName(p)}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="sr-only" htmlFor="qa-due">Due date</label>
            <input id="qa-due" name="dueDate" type="date" className="input" aria-label="Due date" />
          </div>
        </div>
      </ActionForm>
    </Card>
  );
}

function ContentCard({ clientId, posts, month }: { clientId: string; posts: ClientMonth["posts"]; month: string }) {
  const mon = monthLabel(month, "long");
  return (
    <Card
      padded={false}
      title={`Content in ${mon}`}
      actions={<Link href={`/calendar?client=${clientId}&month=${month}`} className="link-quiet">Open calendar</Link>}
    >
      {posts.length === 0 ? (
        <EmptyState title="Nothing scheduled this month">
          <Link href={`/calendar?client=${clientId}&month=${month}`} className="link">Plan posts on the calendar</Link>, or ask Claude to draft a month of captions.
        </EmptyState>
      ) : (
        <ul className="list">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/calendar?client=${clientId}&month=${month}`} className="row post-row">
                <span className={cx("row-title", !p.caption && "is-none")}>{p.caption ? p.caption : "No caption yet"}</span>
                <span className="st"><StatusBadge status={p.status} /></span>
                <span className="post-meta">
                  <span className="when num">{formatDate(p.scheduledFor)}</span>
                  <span className="where">
                    <PlatformTag platform={p.platform} />
                    <span>{humanize(p.format)}</span>
                  </span>
                </span>
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
 * /clients/noraeatsgood: Nora's creator business in one place. Cameron gets the full back-end view: on a phone, top to
 * bottom, collab requests, deals, her tasks and plan, content, then stats, collab leads and saved replies; on a wide
 * screen deals, stats, leads and replies are the side column. Nora (simple) gets just her collab requests, deals,
 * stats and saved replies: her Home already covers shoots, reels and asks.
 */
async function CreatorWorkspace({ data, month, now, simple = false }: { data: ClientMonth; month: string; now: string; simple?: boolean }) {
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

  if (simple) {
    return (
      <>
        <CreatorHeader client={client} />
        <div className="cols biz-cols is-ws">
          <div className="biz-col">
            <CollabRequestsCard newCount={collabs.newCount} reviewingCount={collabs.reviewingCount} latest={collabs.latest} />
          </div>
          <div className="biz-side">
            <DealsCard data={deals} />
          </div>
          <div className="biz-col">
            <CreatorStatsCard platforms={[stats.platforms.instagram, stats.platforms.tiktok]} />
          </div>
          <div className="biz-side">
            <SavedRepliesCard />
          </div>
        </div>
      </>
    );
  }

  const planGroups = await groupPlanTasks(tasks.filter(isPlanTask));
  const inChecklist = new Set(planGroups.filter((g) => g.month === month).map((g) => g.deliverableId));

  return (
    <>
      <CreatorHeader client={client} />
      <div className="cols biz-cols is-ws">
        <div className="biz-col">
          <CollabRequestsCard newCount={collabs.newCount} reviewingCount={collabs.reviewingCount} latest={collabs.latest} />
        </div>
        <div className="biz-side">
          <DealsCard data={deals} />
        </div>

        <div className="biz-col">
          <OutstandingCard
            clientId={client.id}
            clientName={client.name}
            openTasks={tasks}
            planGroups={planGroups}
            month={month}
            now={now}
            pendingDrafts={data.pendingDrafts}
            unrepliedReviews={0}
            needsChecklist={needsChecklist && plan.length > 0}
            defaultAssignee="nora"
            placeholder="e.g. Edit the ramen reel"
          />
          <PlanCard clientId={client.id} plan={plan} month={month} now={now} inChecklist={inChecklist} />
          <ContentCard clientId={client.id} posts={posts} month={month} />
        </div>
        <div className="biz-side">
          <CreatorStatsCard platforms={[stats.platforms.instagram, stats.platforms.tiktok]} />
          <CollabLeadsCard rows={leads.rows} total={leads.total} today={today()} />
          <SavedRepliesCard />
        </div>
      </div>
    </>
  );
}
