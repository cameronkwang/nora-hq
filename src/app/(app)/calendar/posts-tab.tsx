import Link from "next/link";
import type React from "react";
import { and, asc, desc, eq, gte, isNull, lt, ne, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listClients } from "@/lib/data";
import { addMonths, currentMonth, isMonth, monthLabel, relativeTime, today } from "@/lib/dates";
import type { ContentPost } from "@/lib/schema";
import { MonthPicker } from "@/components/month-picker";
import { CalendarFilters } from "@/components/calendar-filters";
import { AgendaList, MonthGrid, StatusDot, StatusLegend, type CalendarItem } from "@/components/calendar-grid";
import { Card, EmptyState, LinkButton, PageHeader, PlatformTag, Status, clientLabel, humanize } from "@/components/ui";
import { timeLabel, utcToZoned, zonedToUtc } from "./tz";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The content calendar (scheduled Instagram/TikTok posts): the "Posts" tab of /calendar. Unchanged behaviour. */
export async function PostsTab({ sp, tabs }: { sp: SP; tabs: React.ReactNode }) {
  const now = currentMonth();
  const month = isMonth(one(sp.month)) ? one(sp.month) : now;
  const client = one(sp.client);
  const platform = one(sp.platform) === "instagram" || one(sp.platform) === "tiktok" ? (one(sp.platform) as "instagram" | "tiktok") : "";
  const msg = one(sp.msg);
  const tone = one(sp.tone);

  const start = zonedToUtc(`${month}-01`)!;
  const end = zonedToUtc(`${addMonths(month, 1)}-01`)!;

  const filters: SQL[] = [];
  if (client) filters.push(eq(schema.contentPosts.clientId, client));
  if (platform) filters.push(eq(schema.contentPosts.platform, platform));

  const db = await getDb();
  const [clients, posts, unscheduled] = await Promise.all([
    listClients({ includeArchived: true }),
    db.select().from(schema.contentPosts)
      .where(and(...filters, gte(schema.contentPosts.scheduledFor, start), lt(schema.contentPosts.scheduledFor, end)))
      .orderBy(asc(schema.contentPosts.scheduledFor)),
    db.select().from(schema.contentPosts)
      .where(and(...filters, isNull(schema.contentPosts.scheduledFor), ne(schema.contentPosts.status, "published")))
      .orderBy(desc(schema.contentPosts.createdAt))
      .limit(60),
  ]);

  const byId = new Map(clients.map((c) => [c.id, c]));
  const fullName = (id: string) => {
    const c = byId.get(id);
    return c ? clientLabel(c) : "Archived business";
  };
  // Same brand at two locations: show the location so chips stay distinguishable.
  const brandCounts = new Map<string, number>();
  for (const c of clients) brandCounts.set(c.name, (brandCounts.get(c.name) ?? 0) + 1);
  const chipName = (id: string) => {
    const c = byId.get(id);
    if (!c) return "Archived";
    return (brandCounts.get(c.name) ?? 0) > 1 && c.location ? `${c.name} (${c.location})` : c.name;
  };

  const toItem = (p: ContentPost): CalendarItem => {
    const z = utcToZoned(p.scheduledFor!);
    return {
      id: p.id, date: z.date, time: timeLabel(p.scheduledFor!), platform: p.platform, status: p.status, format: p.format,
      clientName: chipName(p.clientId), caption: p.caption, mediaCount: p.mediaUrls.length,
    };
  };
  const items = posts.map(toItem);
  const todayStr = today();

  const newHref = (date?: string) => {
    const p = new URLSearchParams();
    if (date) p.set("date", date);
    if (client) p.set("client", client);
    if (platform) p.set("platform", platform);
    const s = p.toString();
    return s ? `/calendar/new?${s}` : "/calendar/new";
  };

  const counts = {
    total: posts.length,
    published: posts.filter((p) => p.status === "published").length,
    failed: posts.filter((p) => p.status === "failed").length,
    needsAction: posts.filter((p) => p.publishMode === "manual" && p.status === "approved" && p.scheduledFor && p.scheduledFor < new Date()).length,
  };

  return (
    <div>
      <div className="sched-head">
        <PageHeader
          title="Content calendar"
          subtitle={`${monthLabel(month)} · ${counts.total} post${counts.total === 1 ? "" : "s"} planned${counts.published ? `, ${counts.published} published` : ""}. Times are Eastern.`}
          actions={
            // A quiet ink action, like the schedule's Add: the screen's one primary is "New ask".
            <LinkButton href={newHref()} variant="ghost" size="sm" className="text-text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden className="size-3.5!">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New post
            </LinkButton>
          }
        />
      </div>
      {tabs}

      {msg && (
        <p role="status" className="notice mt-4">
          <Status tone={tone === "danger" ? "danger" : tone === "warn" ? "warn" : "ok"} className="whitespace-normal text-text">{msg}</Status>
        </p>
      )}

      <div className="sched-bar is-form">
        <MonthPicker month={month} current={now} />
        <CalendarFilters
          month={month === now ? "" : month}
          client={client}
          platform={platform}
          clients={clients.filter((c) => !c.archived || c.id === client).map((c) => ({ id: c.id, label: clientLabel(c) }))}
        />
      </div>

      {(counts.failed > 0 || counts.needsAction > 0) && (
        <div className="mb-4">
          {counts.failed > 0 && (
            <p className="notice">
              <Status tone="danger" className="whitespace-normal">{counts.failed} failed to publish</Status>
            </p>
          )}
          {counts.needsAction > 0 && (
            <p className="notice">
              <Status tone="warn" className="whitespace-normal">{counts.needsAction} past due: post it and mark it published</Status>
            </p>
          )}
        </div>
      )}

      <div className="hidden md:block">
        <MonthGrid month={month} items={items} todayStr={todayStr} newHref={newHref} />
        <StatusLegend />
        {items.length === 0 && (
          <p className="meta mt-3">
            Nothing scheduled this month{client ? " for this business" : ""}. Click a day&apos;s + to add a post, or ask Claude to draft this month&apos;s captions.
          </p>
        )}
      </div>
      <div className="md:hidden">
        {items.length ? (
          <AgendaList items={items} todayStr={todayStr} />
        ) : (
          <div className="mt-4 border-t border-border">
            <EmptyState title={`Nothing scheduled in ${monthLabel(month)}`}>
              <Link href={newHref()} className="link">Add a post</Link> or ask Claude to draft this month&apos;s captions.
            </EmptyState>
          </div>
        )}
      </div>

      {/* Ideas with no date yet. Under the grid, so the month gets the full width. */}
      <Card title={<>Unscheduled <span className="meta num">{unscheduled.length}</span></>} padded={false}>
        {unscheduled.length === 0 ? (
          <p className="sec-note">No loose ideas. Posts without a date show up here.</p>
        ) : (
          <ul className="list max-h-[32rem] max-w-[45rem] overflow-y-auto">
            {unscheduled.map((p) => (
              <li key={p.id}>
                <Link href={`/calendar/${p.id}`} className="cal-post">
                  <span className="main">
                    <span className="row-title break-words">{fullName(p.clientId)}</span>
                    <span className="facts-line meta">
                      <span>
                        <PlatformTag platform={p.platform} inherit />
                      </span>{" "}
                      <span>{humanize(p.format)}</span>{" "}
                      <span>
                        <span className="inline-flex items-baseline gap-1.5">
                          <StatusDot status={p.status} />
                          {p.status === "approved" ? "Ready" : humanize(p.status)}
                        </span>
                      </span>{" "}
                      <span>added {relativeTime(p.createdAt)}</span>
                    </span>
                    {p.caption && <span className="caption meta">{p.caption}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
