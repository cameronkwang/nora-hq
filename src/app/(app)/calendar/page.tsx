import Link from "next/link";
import { and, asc, desc, eq, gte, isNull, lt, ne, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { listClients } from "@/lib/data";
import { addMonths, currentMonth, isMonth, monthLabel, relativeTime, today } from "@/lib/dates";
import type { ContentPost } from "@/lib/schema";
import { MonthPicker } from "@/components/month-picker";
import { CalendarFilters } from "@/components/calendar-filters";
import { AgendaList, MonthGrid, StatusDot, StatusLegend, type CalendarItem } from "@/components/calendar-grid";
import { Card, EmptyState, LinkButton, PageHeader, PlatformTag, clientLabel, cx, humanize } from "@/components/ui";
import { timeLabel, utcToZoned, zonedToUtc } from "./tz";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
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
      <PageHeader
        title="Content calendar"
        subtitle={`${monthLabel(month)} · ${counts.total} post${counts.total === 1 ? "" : "s"} planned${counts.published ? `, ${counts.published} published` : ""}. Times are Eastern.`}
        actions={<LinkButton href={newHref()} variant="primary">+ New post</LinkButton>}
      />

      {msg && (
        <p role="status" className={cx("mb-4 rounded-lg px-4 py-3 text-sm", tone === "danger" ? "bg-danger-soft text-danger" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
          {msg}
        </p>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <MonthPicker month={month} current={now} />
        <CalendarFilters
          month={month === now ? "" : month}
          client={client}
          platform={platform}
          clients={clients.filter((c) => !c.archived || c.id === client).map((c) => ({ id: c.id, label: clientLabel(c) }))}
        />
      </div>

      {(counts.failed > 0 || counts.needsAction > 0) && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {counts.failed > 0 && <span className="rounded-full bg-danger-soft px-3 py-1 font-medium text-danger">{counts.failed} failed to publish</span>}
          {counts.needsAction > 0 && <span className="rounded-full bg-warn-soft px-3 py-1 font-medium text-warn">{counts.needsAction} past due — post it and mark published</span>}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div className="hidden md:block">
            <MonthGrid month={month} items={items} todayStr={todayStr} newHref={newHref} />
            <div className="mt-3"><StatusLegend /></div>
          </div>
          <div className="md:hidden">
            {items.length ? (
              <AgendaList items={items} todayStr={todayStr} />
            ) : (
              <EmptyState title={`Nothing scheduled in ${monthLabel(month)}`}>
                <Link href={newHref()} className="text-accent hover:underline">Add a post</Link> or ask Claude to draft this month&apos;s captions.
              </EmptyState>
            )}
          </div>
          {items.length === 0 && (
            <p className="mt-3 hidden text-sm text-muted md:block">
              Nothing scheduled this month{client ? " for this business" : ""}. Click a day&apos;s + to add a post, or ask Claude to draft this month&apos;s captions.
            </p>
          )}
        </div>

        <aside className="min-w-0">
          <Card title={`Unscheduled (${unscheduled.length})`} padded={false}>
            {unscheduled.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No loose ideas. Posts without a date show up here.</p>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
                {unscheduled.map((p) => (
                  <li key={p.id}>
                    <Link href={`/calendar/${p.id}`} className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-surface-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <StatusDot status={p.status} />
                        <span className="truncate">{fullName(p.clientId)}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <PlatformTag platform={p.platform} /> {humanize(p.format)} · {p.status === "approved" ? "Ready" : humanize(p.status)} · added {relativeTime(p.createdAt)}
                      </span>
                      {p.caption && <span className="line-clamp-2 break-words text-xs text-muted">{p.caption}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
