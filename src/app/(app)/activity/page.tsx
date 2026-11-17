import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listClients } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/dates";
import { EmptyState, PageHeader, buttonClass, clientLabel, cx } from "@/components/ui";
import { actorName, entityHref } from "./actor";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const client = typeof sp.client === "string" ? sp.client : "";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const db = await getDb();
  const where = client ? eq(schema.activity.clientId, client) : undefined;

  const [clients, rows, [{ n: total }]] = await Promise.all([
    listClients({ includeArchived: true }),
    db.select().from(schema.activity).where(where).orderBy(desc(schema.activity.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.activity).where(where),
  ]);
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (client) q.set("client", client);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/activity?${s}` : "/activity";
  };

  return (
    <div>
      <PageHeader title="Activity" subtitle="Everything anyone (or Claude) changed, newest first." />

      <form method="get" action="/activity" className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end max-md:mb-6">
        <div className="min-w-0 sm:w-72">
          <label htmlFor="a-client" className="label">Business</label>
          <select id="a-client" name="client" defaultValue={client} className="input">
            <option value="">All businesses</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{clientLabel(c)}</option>
            ))}
          </select>
        </div>
        <button className={cx(buttonClass("secondary"), "self-start sm:self-auto")}>Filter</button>
      </form>

      {rows.length === 0 ? (
        <div className="border-t border-border">
          <EmptyState title={page > 1 ? "No more activity." : "No activity yet."}>
            {page > 1 ? <Link href={href(1)} className="link">Back to the newest</Link> : "Changes show up here as soon as anyone makes them."}
          </EmptyState>
        </div>
      ) : (
        <ol className="list is-ruled">
          {rows.map((a) => {
            const who = actorName(a.actor);
            const link = a.action.endsWith(".deleted") ? null : entityHref(a.entityType, a.entityId, a.clientId);
            const biz = a.clientId && !client ? names.get(a.clientId) : undefined;
            return (
              <li key={a.id} className="ps-act">
                <p className="min-w-0 break-words">
                  <span className="font-semibold">{who}</span>{" "}
                  {link ? (
                    <Link href={link} className="hover:underline">
                      {a.summary}
                    </Link>
                  ) : (
                    a.summary
                  )}
                </p>
                <p className="row-meta meta">
                  {biz ? (
                    <Link href={`/activity?client=${a.clientId}`} className="biz tap-target hover:text-text hover:underline">
                      {biz}
                    </Link>
                  ) : (
                    <span className="biz" />
                  )}
                  <time className="when num" dateTime={a.createdAt.toISOString()} title={formatDate(a.createdAt, true)}>
                    {relativeTime(a.createdAt)}
                  </time>
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-2">
          {page > 1 ? <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>← Newer</Link> : <span />}
          <span className="meta num">
            Page {Math.min(page, pages)} of {pages}
          </span>
          {page < pages ? <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>Older →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
