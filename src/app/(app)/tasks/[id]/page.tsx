import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listClients } from "@/lib/data";
import { headers } from "next/headers";
import { addMonths, currentMonth, formatDate, lastMonths, monthLabel, relativeTime } from "@/lib/dates";
import { ASSIGNEES, PLATFORMS, TASK_STATUSES } from "@/lib/schema";
import { deleteTaskAction, saveTask } from "../actions";
import { Button, Card, PageHeader, StatusBadge, buttonClass, clientLabel, cx, humanize } from "@/components/ui";
import { actorName } from "../../activity/actor";

export const dynamic = "force-dynamic";

/** Return to the page the user came from (same site, not this task), else /tasks. */
async function backPath(id: string) {
  const h = await headers();
  const ref = h.get("referer");
  const host = h.get("host");
  if (!ref || !host) return "/tasks";
  try {
    const u = new URL(ref);
    if (u.host !== host || u.pathname.startsWith(`/tasks/${id}`)) return "/tasks";
    for (const k of ["added", "saved", "deleted", "error"]) u.searchParams.delete(k);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/tasks";
  }
}

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!task) notFound();

  const [clients, deliverables, drafts, ask] = await Promise.all([
    listClients({ includeArchived: true }),
    task.clientId
      ? db.select().from(schema.deliverables).where(eq(schema.deliverables.clientId, task.clientId)).orderBy(asc(schema.deliverables.sortOrder))
      : Promise.resolve([]),
    db.select().from(schema.drafts).where(eq(schema.drafts.taskId, id)).orderBy(desc(schema.drafts.createdAt)),
    task.askId ? db.select().from(schema.asks).where(eq(schema.asks.id, task.askId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const client = clients.find((c) => c.id === task.clientId) ?? null;
  const visibleClients = clients.filter((c) => !c.archived || c.id === task.clientId);
  const cur = currentMonth();
  const months = Array.from(new Set([task.month, ...lastMonths(6, cur), addMonths(cur, 1), addMonths(cur, 2)])).sort().reverse();
  const error = typeof sp.error === "string" ? sp.error : null;
  const back = await backPath(id);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={back} className="mb-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-text md:min-h-0">
        ← {back.startsWith("/tasks") ? "All tasks" : "Back"}
      </Link>
      <PageHeader
        title={<span className="break-words">{task.title}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            {client && (
              <Link href={`/clients/${client.id}`} className="hover:underline">
                {clientLabel(client)}
              </Link>
            )}
            <span>
              Added by {actorName(task.createdBy)} {relativeTime(task.createdAt)}
              {task.completedAt && ` · done ${formatDate(task.completedAt)}`}
            </span>
          </span>
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <form action={saveTask} className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="returnTo" value={back} />

        {/* Main: what it is + notes */}
        <Card>
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="t-title" className="label">Title</label>
              <input id="t-title" name="title" required defaultValue={task.title} className="input" />
            </div>
            <div>
              <label htmlFor="t-details" className="label">Notes</label>
              <textarea
                id="t-details"
                name="details"
                rows={10}
                defaultValue={task.details ?? ""}
                className="input min-h-48 leading-relaxed"
                placeholder="Links, context, what’s been tried, what’s next…"
              />
            </div>
          </div>
        </Card>

        {/* Side: the properties */}
        <Card>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            <div>
              <label htmlFor="t-status" className="label">Status</label>
              <select id="t-status" name="status" defaultValue={task.status} className="input">
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="t-assignee" className="label">Assignee</label>
              <select id="t-assignee" name="assignee" defaultValue={task.assignee} className="input">
                {ASSIGNEES.map((a) => (
                  <option key={a} value={a}>{humanize(a)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 lg:col-span-1">
              <label htmlFor="t-client" className="label">Business</label>
              <select id="t-client" name="clientId" defaultValue={task.clientId ?? ""} className="input">
                <option value="">No business</option>
                {visibleClients.map((c) => (
                  <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="t-due" className="label">Due date</label>
              <input id="t-due" name="dueDate" type="date" defaultValue={task.dueDate ?? ""} className="input" />
            </div>
            <div>
              <label htmlFor="t-platform" className="label">Platform</label>
              <select id="t-platform" name="platform" defaultValue={task.platform ?? ""} className="input">
                <option value="">None</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p === "tiktok" ? "TikTok" : humanize(p)}</option>
                ))}
              </select>
            </div>

            <details className="col-span-2 lg:col-span-1" open={task.month !== cur || !!task.deliverableId}>
              <summary className="no-marker flex min-h-11 items-center gap-1 text-sm font-medium text-muted hover:text-text lg:min-h-0">
                Month &amp; monthly plan
                <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                <div>
                  <label htmlFor="t-month" className="label">Counts toward month</label>
                  <select id="t-month" name="month" defaultValue={task.month} className="input">
                    {months.map((m) => (
                      <option key={m} value={m}>{monthLabel(m)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="t-deliverable" className="label">Monthly plan item</label>
                  <select id="t-deliverable" name="deliverableId" defaultValue={task.deliverableId ?? ""} className="input" disabled={!task.clientId}>
                    <option value="">{task.clientId ? "Not part of the monthly plan" : "Pick a business first"}</option>
                    {deliverables.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                        {d.targetPerMonth > 0 ? ` (${d.targetPerMonth}/mo)` : ""}
                        {d.active ? "" : " — paused"}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted">Done tasks linked here count toward the business’s monthly progress. Changing the business clears this.</p>
                </div>
              </div>
            </details>
          </div>
        </Card>

        <div className="sticky-actions flex items-center gap-2 rounded-xl border border-border bg-surface/95 p-2 shadow-sm backdrop-blur lg:col-span-2 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <Button type="submit" variant="primary" className="flex-1 sm:flex-none">Save</Button>
          <Link href={back} className={cx(buttonClass("ghost"), "text-muted")}>
            Cancel
          </Link>
        </div>
      </form>

      {(ask || drafts.length > 0) && (
        <Card title="Linked" className="mt-4 lg:max-w-[calc(100%-21rem)]">
          <ul className="flex flex-col gap-2 text-sm">
            {ask && (
              <li>
                From ask:{" "}
                <Link href={`/asks/${ask.id}`} className="text-accent hover:underline">
                  {ask.body.length > 120 ? `${ask.body.slice(0, 120)}…` : ask.body}
                </Link>
              </li>
            )}
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={d.status} />
                <Link href={`/review?draft=${d.id}`} className="min-w-0 break-words hover:underline">
                  {d.title}
                </Link>
                <span className="text-xs text-muted">{humanize(d.kind)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form action={deleteTaskAction} className="mt-6 border-t border-border pt-4">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="returnTo" value={back} />
        <Button type="submit" variant="danger" size="sm">Delete task</Button>
        <span className="ml-3 text-xs text-muted">This can’t be undone.</span>
      </form>
    </div>
  );
}
