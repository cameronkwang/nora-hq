import Link from "next/link";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assigneeFor, requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { askThreadState, listAskMessagesFor } from "@/lib/ops";
import { AskAttachments } from "@/components/ask-attachments";
import { AskRouteBadges, personKey } from "@/components/ask-route";
import { AskStatusButtons } from "@/components/ask-status-buttons";
import { EmptyState, LinkButton, PageHeader, Status, clientLabel } from "@/components/ui";
import { actorName } from "../activity/actor";

export const dynamic = "force-dynamic";

type TabKey = "inbox" | "nora" | "cameron" | "ideas" | "done" | "archived";

/** One tab per person so either of you can see the other's queue. */
const PEOPLE = ["nora", "cameron"] as const;

const TABS: Array<{ key: TabKey; label: string; empty: string }> = [
  { key: "inbox", label: "Inbox", empty: "Inbox zero. Drop an ask whenever something comes up." },
  { key: "nora", label: "For Nora", empty: "Nothing waiting on Nora right now." },
  { key: "cameron", label: "For Cameron", empty: "Nothing waiting on Cameron right now." },
  { key: "ideas", label: "Ideas", empty: "No ideas saved yet. Pick “Just an idea” on a new ask to park one here." },
  { key: "done", label: "Done", empty: "No finished asks yet." },
];
const ARCHIVED = { key: "archived" as const, label: "Archived", empty: "Nothing archived." };

/** Old links used ?status=…; map them onto the new tabs. */
const LEGACY: Record<string, TabKey> = { new: "inbox", in_progress: "inbox", done: "done", archived: "archived" };

export default async function AsksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const me = personKey(assigneeFor(user));
  const rawTab = typeof sp.tab === "string" ? sp.tab : typeof sp.status === "string" ? LEGACY[sp.status] : undefined;
  const asked = rawTab === "me" ? me ?? undefined : rawTab; // old "For me" links → your own tab
  const tab = [...TABS, ARCHIVED].find((t) => t.key === asked) ?? TABS[0];
  const db = await getDb();

  const open = inArray(schema.asks.status, ["new", "in_progress"]);
  // "For <person>": routed to them, or an open task from the ask is on their list.
  const forPerson = (who: (typeof PEOPLE)[number]): SQL =>
    and(open, or(eq(schema.asks.forWho, who), inArray(schema.asks.id,
      db.select({ id: sql<string>`${schema.tasks.askId}` }).from(schema.tasks)
        .where(and(eq(schema.tasks.assignee, who), ne(schema.tasks.status, "done"), sql`${schema.tasks.askId} is not null`)))))!;
  const where: Record<TabKey, SQL> = {
    inbox: and(open, ne(schema.asks.kind, "idea"))!,
    nora: forPerson("nora"),
    cameron: forPerson("cameron"),
    ideas: and(eq(schema.asks.kind, "idea"), ne(schema.asks.status, "archived"))!,
    done: eq(schema.asks.status, "done"),
    archived: eq(schema.asks.status, "archived"),
  };
  const count = (w: SQL) => db.select({ n: sql<number>`count(*)::int` }).from(schema.asks).where(w).then((r) => r[0]?.n ?? 0);

  const [rows, nInbox, nNora, nCameron, nIdeas] = await Promise.all([
    db
      .select({ ask: schema.asks, client: schema.clients })
      .from(schema.asks)
      .leftJoin(schema.clients, eq(schema.asks.clientId, schema.clients.id))
      .where(where[tab.key])
      .orderBy(tab.key === "inbox" || tab.key === "nora" || tab.key === "cameron" ? desc(schema.asks.createdAt) : desc(schema.asks.updatedAt))
      .limit(200),
    count(where.inbox),
    count(where.nora),
    count(where.cameron),
    count(where.ideas),
  ]);
  const counts: Partial<Record<TabKey, number>> = { inbox: nInbox, nora: nNora, cameron: nCameron, ideas: nIdeas };
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
        subtitle="Anything you drop in: requests, ideas, FYIs. Claude sorts them and gets to work."
        actions={<LinkButton href="/asks/new">+ New ask</LinkButton>}
      />

      {sent && (
        <p role="status" className="notice mb-4">
          <Status tone="ok" className="whitespace-normal">Sent. Claude sorts it next time it checks in.</Status>
        </p>
      )}

      {/* Whose list: filter chips (the selected one is ink). One line; it scrolls sideways on a small phone. */}
      <nav aria-label="Ask lists" className="-mx-4 mb-3 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="chips min-w-max flex-nowrap">
          {TABS.map((t) => (
            <Link key={t.key} href={t.key === "inbox" ? "/asks" : `/asks?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined} className="chip">
              <span>
                {t.label}
                {(counts[t.key] ?? 0) > 0 && <i>{counts[t.key]}</i>}
              </span>
            </Link>
          ))}
        </div>
      </nav>

      {rows.length === 0 ? (
        <div className="border-t border-border pt-1">
          <EmptyState title={tab.empty}>
            {tab.key === "inbox" && (
              <LinkButton href="/asks/new" size="sm" className="mt-3">
                Drop an ask
              </LinkButton>
            )}
          </EmptyState>
        </div>
      ) : (
        <ul className="list is-ruled">
          {rows.map(({ ask, client }) => {
            const nTasks = tasksFor(ask.id);
            const nDrafts = draftsFor(ask.id);
            const thread = threads.get(ask.id) ?? [];
            const last = thread.at(-1);
            const convo = askThreadState(ask, last, !!ask.claudeNote || thread.some((m) => m.author === "claude"));
            // Preview the latest word in the conversation (a message, or Claude's note if there are none).
            const latest = last ? { claude: last.author === "claude", who: actorName(last.author), body: last.body } : ask.claudeNote ? { claude: true, who: "Claude", body: ask.claudeNote } : null;
            return (
              <li key={ask.id} className="ask-item">
                <p className="meta mb-1">
                  {client ? (
                    <Link href={`/clients/${client.id}`} className="font-medium text-text hover:underline">
                      {clientLabel(client)}
                    </Link>
                  ) : (
                    <span>No business set</span>
                  )}
                  <span aria-hidden> · </span>
                  <span>
                    {actorName(ask.createdBy)}, {relativeTime(ask.createdAt)}
                  </span>
                </p>

                <Link href={`/asks/${ask.id}`} className="ask-body">
                  {ask.body.length > 600 ? `${ask.body.slice(0, 600)}…` : ask.body}
                </Link>

                {ask.attachments.length > 0 && (
                  <div className="mt-3">
                    <AskAttachments items={ask.attachments} />
                  </div>
                )}

                {latest && (
                  <Link href={`/asks/${ask.id}`} className="ask-quote mt-3">
                    <span className="meta mb-0.5 block">
                      <b className="font-semibold text-text">{latest.who}</b>
                      {thread.length > 1 && <span> · {thread.length + (ask.claudeNote ? 1 : 0)} messages</span>}
                    </span>
                    <span className="line-clamp-3 whitespace-pre-wrap break-words">{latest.body}</span>
                  </Link>
                )}

                <div className="ask-foot">
                  <div className="ask-facts">
                    <AskRouteBadges ask={ask} />
                    {convo === "claude_asked" && <Status tone="warn" small>Claude asked a question</Status>}
                    {convo === "replied" && <Status tone="info" small>Replied</Status>}
                    {nTasks > 0 && <span className="meta">{nTasks} task{nTasks === 1 ? "" : "s"}</span>}
                    {nDrafts > 0 && <span className="meta">{nDrafts} draft{nDrafts === 1 ? "" : "s"}</span>}
                    <Link href={`/asks/${ask.id}`} className="link text-sm">
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
        <p className="mt-2">
          <Link href="/asks?tab=archived" className="link-quiet inline-flex min-h-11 items-center">
            See archived asks →
          </Link>
        </p>
      )}
      {tab.key === "archived" && (
        <p className="mt-2">
          <Link href="/asks?tab=done" className="link-quiet inline-flex min-h-11 items-center">
            ← Back to Done
          </Link>
        </p>
      )}
    </div>
  );
}
