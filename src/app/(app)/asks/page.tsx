import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { relativeTime } from "@/lib/dates";
import type { AskStatus } from "@/lib/schema";
import { AskAttachments } from "@/components/ask-attachments";
import { AskStatusButtons } from "@/components/ask-status-buttons";
import { Badge, EmptyState, LinkButton, PageHeader, clientLabel, cx } from "@/components/ui";
import { actorName } from "../activity/actor";

export const dynamic = "force-dynamic";

const TABS: Array<{ status: AskStatus; label: string; empty: string }> = [
  { status: "new", label: "New", empty: "Nothing new. Drop an ask whenever something comes up." },
  { status: "in_progress", label: "In progress", empty: "Nothing in progress right now." },
  { status: "done", label: "Done", empty: "No finished asks yet." },
  { status: "archived", label: "Archived", empty: "Nothing archived." },
];

export default async function AsksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = (TABS.find((t) => t.status === sp.status)?.status ?? "new") as AskStatus;
  const created = sp.created === "1";
  const db = await getDb();

  const [rows, counts] = await Promise.all([
    db
      .select({ ask: schema.asks, client: schema.clients })
      .from(schema.asks)
      .leftJoin(schema.clients, eq(schema.asks.clientId, schema.clients.id))
      .where(eq(schema.asks.status, status))
      .orderBy(status === "new" ? desc(schema.asks.createdAt) : desc(schema.asks.updatedAt))
      .limit(200),
    db.select({ status: schema.asks.status, n: sql<number>`count(*)::int` }).from(schema.asks).groupBy(schema.asks.status),
  ]);

  const ids = rows.map((r) => r.ask.id);
  const [taskCounts, draftCounts] = ids.length
    ? await Promise.all([
        db.select({ askId: schema.tasks.askId, n: sql<number>`count(*)::int` }).from(schema.tasks).where(inArray(schema.tasks.askId, ids)).groupBy(schema.tasks.askId),
        db.select({ askId: schema.drafts.askId, n: sql<number>`count(*)::int` }).from(schema.drafts).where(inArray(schema.drafts.askId, ids)).groupBy(schema.drafts.askId),
      ])
    : [[], []];
  const tasksFor = (id: string) => taskCounts.find((t) => t.askId === id)?.n ?? 0;
  const draftsFor = (id: string) => draftCounts.find((t) => t.askId === id)?.n ?? 0;
  const countFor = (s: AskStatus) => counts.find((c) => c.status === s)?.n ?? 0;
  const tab = TABS.find((t) => t.status === status)!;

  return (
    <div>
      <PageHeader
        title="Asks"
        subtitle="Quick requests for Claude. It reads new asks, does the work, and leaves a note here."
        actions={<LinkButton href="/asks/new" variant="primary">+ New ask</LinkButton>}
      />

      {created && (
        <p role="status" className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          Ask sent. Claude picks it up next time it checks the queue.
        </p>
      )}

      <nav aria-label="Ask status" className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex min-w-max gap-1 rounded-lg bg-surface-2 p-1 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.status}
              href={t.status === "new" ? "/asks" : `/asks?status=${t.status}`}
              aria-current={t.status === status ? "page" : undefined}
              className={cx(
                "rounded-md px-3 py-1.5 font-medium",
                t.status === status ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {t.label}
              {countFor(t.status) > 0 && <span className="ml-1.5 text-xs tabular-nums text-muted">{countFor(t.status)}</span>}
            </Link>
          ))}
        </div>
      </nav>

      {rows.length === 0 ? (
        <EmptyState title={tab.empty}>
          {status === "new" && (
            <LinkButton href="/asks/new" variant="primary" size="sm" className="mt-3">
              Drop an ask
            </LinkButton>
          )}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ ask, client }) => {
            const nTasks = tasksFor(ask.id);
            const nDrafts = draftsFor(ask.id);
            return (
              <li key={ask.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  {client ? (
                    <Link href={`/clients/${client.id}`} className="font-medium text-text hover:underline">
                      {clientLabel(client)}
                    </Link>
                  ) : (
                    <span>No business set</span>
                  )}
                  <span aria-hidden>·</span>
                  <span>
                    {actorName(ask.createdBy)}, {relativeTime(ask.createdAt)}
                  </span>
                </div>

                <Link href={`/asks/${ask.id}`} className="block whitespace-pre-wrap break-words text-sm hover:underline">
                  {ask.body.length > 600 ? `${ask.body.slice(0, 600)}…` : ask.body}
                </Link>

                {ask.attachments.length > 0 && (
                  <div className="mt-3">
                    <AskAttachments items={ask.attachments} />
                  </div>
                )}

                {ask.claudeNote && (
                  <div className="mt-3 rounded-lg border-l-4 border-accent bg-accent-soft px-3 py-2 text-sm">
                    <p className="mb-0.5 text-xs font-semibold text-accent">Claude</p>
                    <p className="whitespace-pre-wrap break-words">{ask.claudeNote}</p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {nTasks > 0 && <Badge>{nTasks} task{nTasks === 1 ? "" : "s"}</Badge>}
                    {nDrafts > 0 && <Badge tone="warn">{nDrafts} draft{nDrafts === 1 ? "" : "s"}</Badge>}
                    <Link href={`/asks/${ask.id}`} className="text-xs font-medium text-accent hover:underline">
                      Open
                    </Link>
                  </div>
                  <AskStatusButtons id={ask.id} status={ask.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
