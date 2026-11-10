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

      <form method="get" action="/activity" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 sm:w-72">
          <label htmlFor="a-client" className="label">Business</label>
          <select id="a-client" name="client" defaultValue={client} className="input">
            <option value="">All businesses</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{clientLabel(c)}</option>
            ))}
          </select>
        </div>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={page > 1 ? "No more activity." : "No activity yet."}>
          {page > 1 ? <Link href={href(1)} className="text-accent hover:underline">Back to the newest</Link> : "Changes show up here as soon as anyone makes them."}
        </EmptyState>
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border bg-surface">
          {rows.map((a) => {
            const who = actorName(a.actor);
            const link = a.action.endsWith(".deleted") ? null : entityHref(a.entityType, a.entityId, a.clientId);
            return (
              <li key={a.id} className="flex gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className={cx(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    who === "Claude" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
                  )}
                >
                  {who.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm">
                    <span className="font-semibold">{who}</span>{" "}
                    {link ? (
                      <Link href={link} className="hover:underline">
                        {a.summary}
                      </Link>
                    ) : (
                      a.summary
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    <time dateTime={a.createdAt.toISOString()} title={formatDate(a.createdAt, true)}>
                      {relativeTime(a.createdAt)}
                    </time>
                    {a.clientId && names.get(a.clientId) && !client && (
                      <>
                        {" · "}
                        <Link href={`/activity?client=${a.clientId}`} className="hover:underline">
                          {names.get(a.clientId)}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-2 text-sm">
          {page > 1 ? <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>← Newer</Link> : <span />}
          <span className="text-muted">
            Page {Math.min(page, pages)} of {pages}
          </span>
          {page < pages ? <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>Older →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
