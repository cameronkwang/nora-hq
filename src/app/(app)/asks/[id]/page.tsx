import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assigneeFor, requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/dates";
import { AskAttachments } from "@/components/ask-attachments";
import { AskReply } from "@/components/ask-reply";
import { personKey, routesFor } from "@/components/ask-route";
import { AskRoutePicker } from "@/components/ask-route-picker";
import { AskStatusButtons } from "@/components/ask-status-buttons";
import { AskThread, type ThreadItem } from "@/components/ask-thread";
import { askThreadState, listAskMessages } from "@/lib/ops";
import { TaskList, TaskRow } from "@/components/task-row";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { KIND_LABELS } from "@/components/draft-checks";
import { Button, Card, EmptyState, PageHeader, Status, StatusBadge, clientLabel, humanize } from "@/components/ui";
import { setAskClient } from "../actions";
import { actorName } from "../../activity/actor";

export const dynamic = "force-dynamic";

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const [ask] = await db.select().from(schema.asks).where(eq(schema.asks.id, id));
  if (!ask) notFound();

  const [clients, tasks, drafts, messages] = await Promise.all([
    listClients({ includeArchived: true }),
    db.select().from(schema.tasks).where(eq(schema.tasks.askId, id)).orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)),
    db.select().from(schema.drafts).where(eq(schema.drafts.askId, id)).orderBy(desc(schema.drafts.createdAt)),
    listAskMessages(id),
  ]);
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const client = clients.find((c) => c.id === ask.clientId) ?? null;
  const activeClients = clients.filter((c) => !c.archived || c.id === ask.clientId);

  // Claude's note (its latest summary) opens the conversation, then the messages in order.
  const thread: ThreadItem[] = [
    ...(ask.claudeNote ? [{ id: "note", claude: true, who: "Claude", body: ask.claudeNote }] : []),
    ...messages.map((m) => ({
      id: m.id,
      claude: m.author === "claude",
      who: actorName(m.author),
      body: m.body,
      when: relativeTime(m.createdAt),
      whenTitle: formatDate(m.createdAt, true),
    })),
  ];
  const state = askThreadState(ask, messages.at(-1), thread.some((t) => t.claude));
  const canReply = ask.status === "new" || ask.status === "in_progress";

  const back = ask.status === "done" || ask.status === "archived" ? `/asks?tab=${ask.status}` : ask.kind === "idea" ? "/asks?tab=ideas" : "/asks";

  return (
    <div>
      <PageHeader
        crumb={<Link href={back}>Asks</Link>}
        title="Ask"
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <StatusBadge status={ask.status} />
            <span>
              {/* Sent through a business's owner drop link (/drop/<token>): the note and files are the owner's. */}
              From {ask.dropLinkId ? "the owner (drop link)" : actorName(ask.createdBy)} · {formatDate(ask.createdAt, true)} ({relativeTime(ask.createdAt)})
            </span>
          </span>
        }
        actions={<AskStatusButtons id={ask.id} status={ask.status} />}
      />

      <div className="cols mt-0">
        {/* Conversation. The reply box sticks to the bottom of this column only, so it never covers the details below on phones. */}
        <section aria-label="Ask and conversation" className="min-w-0">
          <Card>
            <p className="whitespace-pre-wrap break-words">{ask.body}</p>
            {ask.attachments.length > 0 && (
              <div className="mt-4">
                <AskAttachments items={ask.attachments} size="lg" />
              </div>
            )}
            <div className="mt-5 flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="label mb-0 shrink-0">Who&rsquo;s it for?</span>
              <AskRoutePicker ask={ask} routes={routesFor(personKey(assigneeFor(user)))} />
            </div>
          </Card>

          <Card
            title="Conversation"
            actions={state ? state === "claude_asked" ? <Status tone="warn" small>Claude asked a question</Status> : <Status tone="info" small>Replied</Status> : undefined}
            padded={false}
          >
            <AskThread
              items={thread}
              empty={ask.status === "new" ? "Not picked up yet. Claude reads new asks next time it checks the queue." : "No messages yet."}
            />
          </Card>

          {canReply ? (
            <AskReply askId={ask.id} placeholder={state === "claude_asked" ? "Answer Claude…" : "Add a note for Claude…"} />
          ) : (
            <p className="meta mt-3">This ask is {ask.status === "done" ? "done" : "archived"}. Reopen it to keep the conversation going.</p>
          )}
        </section>

        <div className="min-w-0">
          <Card title="Business">
            <form action={setAskClient} className="flex items-end gap-2">
              <input type="hidden" name="id" value={ask.id} />
              <div className="min-w-0 flex-1">
                <label htmlFor="ask-client" className="sr-only">Business</label>
                <select id="ask-client" name="clientId" defaultValue={ask.clientId ?? ""} className="input">
                  <option value="">Not set</option>
                  {activeClients.map((c) => (
                    <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                  ))}
                </select>
              </div>
              <Button type="submit">Save</Button>
            </form>
            {client && (
              <Link href={`/clients/${client.id}`} className="link mt-3 inline-block text-sm">
                Open {client.name}
              </Link>
            )}
          </Card>

          <Card title={<>Tasks from this ask{tasks.length > 0 && <span className="meta">{tasks.length}</span>}</>} padded={false}>
            {tasks.length ? (
              <TaskList>
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} showClient={t.clientId !== ask.clientId} />
                ))}
              </TaskList>
            ) : (
              <p className="sec-note">No tasks yet. Claude adds them when it works the ask, or add one here.</p>
            )}
            <details className="mt-1">
              <summary className="inbox-disclose">Add a task for this ask</summary>
              <div className="pb-1 pt-2">
                <TaskQuickAdd
                  clients={activeClients.filter((c) => !c.archived).map((c) => ({ id: c.id, label: clientLabel(c) }))}
                  defaultClientId={ask.clientId ?? undefined}
                  defaultAssignee={assigneeFor(user)}
                  returnTo={`/asks/${ask.id}`}
                  askId={ask.id}
                />
              </div>
            </details>
          </Card>

          <Card title={<>Drafts from this ask{drafts.length > 0 && <span className="meta">{drafts.length}</span>}</>} padded={false}>
            {drafts.length ? (
              <ul className="list">
                {drafts.map((d) => (
                  <li key={d.id} className="py-2.5">
                    <Link href={`/review?draft=${d.id}`} className="block break-words font-medium hover:underline">
                      {d.title}
                    </Link>
                    <p className="meta flex flex-wrap items-baseline gap-x-3">
                      <StatusBadge status={d.status} />
                      <span>
                        {KIND_LABELS[d.kind] ?? humanize(d.kind)}
                        {d.clientId && names.get(d.clientId) ? ` · ${names.get(d.clientId)}` : ""} · {relativeTime(d.createdAt)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No drafts yet">Anything Claude writes for this ask shows up here and in the review queue.</EmptyState>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
