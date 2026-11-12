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
import { Badge, Button, Card, EmptyState, PageHeader, StatusBadge, clientLabel, humanize } from "@/components/ui";
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

  return (
    <div className="mx-auto max-w-3xl lg:max-w-6xl">
      <Link href={ask.status === "done" || ask.status === "archived" ? `/asks?tab=${ask.status}` : ask.kind === "idea" ? "/asks?tab=ideas" : "/asks"} className="mb-3 inline-block text-sm text-muted hover:text-text">
        ← Asks
      </Link>
      <PageHeader
        title="Ask"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ask.status} />
            <span>
              From {actorName(ask.createdBy)} · {formatDate(ask.createdAt, true)} ({relativeTime(ask.createdAt)})
            </span>
          </span>
        }
        actions={<AskStatusButtons id={ask.id} status={ask.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {/* Conversation. The reply box sticks to the bottom of this column only, so it never covers the details below on phones. */}
        <section aria-label="Ask and conversation" className="flex min-w-0 flex-col gap-4">
          <Card>
            <p className="whitespace-pre-wrap break-words text-base">{ask.body}</p>
            {ask.attachments.length > 0 && (
              <div className="mt-4">
                <AskAttachments items={ask.attachments} size="lg" />
              </div>
            )}
            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:gap-3">
              <span className="shrink-0 text-xs font-semibold text-muted">Who&rsquo;s it for?</span>
              <AskRoutePicker ask={ask} routes={routesFor(personKey(assigneeFor(user)))} />
            </div>
          </Card>

          {state && (
            <div>
              {state === "claude_asked" ? <Badge tone="warn">Claude asked a question</Badge> : <Badge tone="info">Replied</Badge>}
            </div>
          )}

          <AskThread
            items={thread}
            empty={ask.status === "new" ? "Not picked up yet. Claude reads new asks next time it checks the queue." : "No messages yet."}
          />

          {canReply ? (
            <AskReply askId={ask.id} placeholder={state === "claude_asked" ? "Answer Claude…" : "Add a note for Claude…"} />
          ) : (
            <p className="px-1 text-sm text-muted">This ask is {ask.status === "done" ? "done" : "archived"}. Reopen it to keep the conversation going.</p>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Business">
            <form action={setAskClient} className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
              <Link href={`/clients/${client.id}`} className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
                Open {client.name}
              </Link>
            )}
          </Card>

          <Card title={`Tasks from this ask${tasks.length ? ` · ${tasks.length}` : ""}`}>
            {tasks.length ? (
              <TaskList>
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} clientName={t.clientId ? names.get(t.clientId) : null} showClient={t.clientId !== ask.clientId} />
                ))}
              </TaskList>
            ) : (
              <p className="text-sm text-muted">No tasks yet. Claude adds them when it works the ask, or add one here.</p>
            )}
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-medium text-accent pointer-coarse:py-3">Add a task for this ask</summary>
              <div className="mt-3">
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

          <Card title={`Drafts from this ask${drafts.length ? ` · ${drafts.length}` : ""}`}>
            {drafts.length ? (
              <ul className="divide-y divide-border">
                {drafts.map((d) => (
                  <li key={d.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/review?draft=${d.id}`} className="block break-words text-sm font-medium hover:underline">
                        {d.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {humanize(d.kind)}
                        {d.clientId && names.get(d.clientId) ? ` · ${names.get(d.clientId)}` : ""} · {relativeTime(d.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
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
