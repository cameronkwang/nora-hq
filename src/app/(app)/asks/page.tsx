import Link from "next/link";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assigneeFor, requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { askThreadState, listAskMessagesFor } from "@/lib/ops";
import { AskAttachments } from "@/components/ask-attachments";
import { AskRouteBadges, personKey } from "@/components/ask-route";
import { AskStatusButtons } from "@/components/ask-status-buttons";
import { Badge, EmptyState, LinkButton, PageHeader, clientLabel, cx } from "@/components/ui";
import { actorName } from "../activity/actor";

export const dynamic = "force-dynamic";

type TabKey = "inbox" | "me" | "ideas" | "done" | "archived";

const TABS: Array<{ key: TabKey; label: string; empty: string }> = [
  { key: "inbox", label: "Inbox", empty: "Inbox zero. Drop an ask whenever something comes up." },
  { key: "me", label: "For me", empty: "Nothing routed to you right now." },
  { key: "ideas", label: "Ideas", empty: "No ideas saved yet. Pick “Just an idea” on a new ask to park one here." },
  { key: "done", label: "Done", empty: "No finished asks yet." },
];
const ARCHIVED = { key: "archived" as const, label: "Archived", empty: "Nothing archived." };

/** Old links used ?status=…; map them onto the new tabs. */
const LEGACY: Record<string, TabKey> = { new: "inbox", in_progress: "inbox", done: "done", archived: "archived" };

export default async function AsksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const asked = typeof sp.tab === "string" ? sp.tab : typeof sp.status === "string" ? LEGACY[sp.status] : undefined;
  const tab = [...TABS, ARCHIVED].find((t) => t.key === asked) ?? TABS[0];
  const me = personKey(assigneeFor(user));
  const db = await getDb();

  const open = inArray(schema.asks.status, ["new", "in_progress"]);
  // "For me": routed to me, or an open task from the ask is on my list.
  const mine: SQL = me
    ? and(open, or(eq(schema.asks.forWho, me), inArray(schema.asks.id,
        db.select({ id: sql<string>`${schema.tasks.askId}` }).from(schema.tasks)
          .where(and(eq(schema.tasks.assignee, me), ne(schema.tasks.status, "done"), sql`${schema.tasks.askId} is not null`)))))!
    : sql`false`;
  const where: Record<TabKey, SQL> = {
    inbox: and(open, ne(schema.asks.kind, "idea"))!,
    me: mine,
    ideas: and(eq(schema.asks.kind, "idea"), ne(schema.asks.status, "archived"))!,
    done: eq(schema.asks.status, "done"),
    archived: eq(schema.asks.status, "archived"),
  };
  const count = (w: SQL) => db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(w).then((r) => r[0]?.n ?? 0);

  const [rows, nInbox, nMe, nIdeas] = await Promise.all([
    db
      .select({ ask: schema.asks, client: schema.clients })
      .from(schema.asks)
      .leftJoin(schema.clients, eq(schema.asks.clientId, schema.clients.id))
      .where(where[tab.key])
      .orderBy(tab.key === "inbox" || tab.key === "me" ? desc(schema.asks.createdAt) : desc(schema.asks.updatedAt))
      .limit(200),
    count(where.inbox),
    count(where.me),
    count(where.ideas),
  ]);
  const counts: Partial<Record<TabKey, number>> = { inbox: nInbox, me: nMe, ideas: nIdeas };
  const sent = typeof sp.created === "string";

  const ids = rows.map((r) => r.ask.id);
  const [taskCounts, draftCounts, threads] = ids.length
    ? await Promise.all([
        db.select({ askId: schema.tasks.askId, n: sql<number>`count(*)::int` }).from(schema.tasks).where(inArray(schema.tasks.askId, ids)).groupBy(schema.tasks.askId),
        db.select({ askId: schema.drafts.askId, n: sql<number>`count(*)::int` }).from(schema.drafts).where(inArray(schema.drafts.askId, ids)).groupBy(schema.drafts.askId),
        listAskMessagesFor(ids),
      ])
    : [[], [], new Map<string, schema.AskMessage[]>()];
  const tasksFor = (id: string) => taskCounts.find((t) => t.askId === id)?.n ?? 0;
  const draftsFor = (id: string) => draftCounts.find((t) => t.askId === id)?.n ?? 0;

  return (
    <div>
      <PageHeader
        title="Asks"
        subtitle="Anything you drop in — requests, ideas, FYIs. Claude sorts them and gets to work."
        actions={<LinkButton href="/asks/new" variant="primary">+ New ask</LinkButton>}
      />

      {sent && (
        <p role="status" className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          Sent. Claude sorts it next time it checks in.
        </p>
      )}

      <nav aria-label="Ask lists" className="relative -mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex min-w-max gap-1 rounded-lg bg-surface-2 p-1 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "inbox" ? "/asks" : `/asks?tab=${t.key}`}
              aria-current={t.key === tab.key ? "page" : undefined}
              className={cx(
                "inline-flex items-center rounded-md px-3 py-1.5 font-medium pointer-coarse:min-h-11",
                t.key === tab.key ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
              )}
            >
              {t.label}
              {(counts[t.key] ?? 0) > 0 && <span className="ml-1.5 text-xs tabular-nums text-muted">{counts[t.key]}</span>}
            </Link>
          ))}
        </div>
      </nav>

      {rows.length === 0 ? (
        <EmptyState title={tab.empty}>
          {tab.key === "inbox" && (
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
            const thread = threads.get(ask.id) ?? [];
            const last = thread.at(-1);
            const convo = askThreadState(ask, last, !!ask.claudeNote || thread.some((m) => m.author === "claude"));
            // Preview the latest word in the conversation (a message, or Claude's note if there are none).
            const latest = last ? { claude: last.author === "claude", who: actorName(last.author), body: last.body } : ask.claudeNote ? { claude: true, who: "Claude", body: ask.claudeNote } : null;
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

                {latest && (
                  <Link
                    href={`/asks/${ask.id}`}
                    className={cx(
                      "mt-3 block rounded-lg px-3 py-2 text-sm hover:opacity-90",
                      latest.claude ? "border-l-4 border-accent bg-accent-soft" : "bg-surface-2",
                    )}
                  >
                    <span className={cx("mb-0.5 block text-xs font-semibold", latest.claude ? "text-accent" : "text-muted")}>
                      {latest.who}
                      {thread.length > 1 && <span className="font-normal text-muted"> · {thread.length + (ask.claudeNote ? 1 : 0)} messages</span>}
                    </span>
                    <span className="line-clamp-3 whitespace-pre-wrap break-words">{latest.body}</span>
                  </Link>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AskRouteBadges ask={ask} />
                    {convo === "claude_asked" && <Badge tone="warn">Claude asked a question</Badge>}
                    {convo === "replied" && <Badge tone="info">Replied</Badge>}
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

      {tab.key === "done" && (
        <p className="mt-4 text-center text-sm">
          <Link href="/asks?tab=archived" className="inline-flex min-h-11 items-center text-muted hover:text-text hover:underline">
            See archived asks
          </Link>
        </p>
      )}
      {tab.key === "archived" && (
        <p className="mb-2 mt-4 text-center text-sm">
          <Link href="/asks?tab=done" className="inline-flex min-h-11 items-center text-muted hover:text-text hover:underline">
            ← Back to Done
          </Link>
        </p>
      )}
    </div>
  );
}
