import Link from "next/link";
import { and, asc, desc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assigneeFor, requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { addMonths, currentMonth, isMonth, lastMonths, monthLabel, today } from "@/lib/dates";
import { ASSIGNEES, TASK_STATUSES, type Task } from "@/lib/schema";
import { TaskList, TaskRow } from "@/components/task-row";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { Card, EmptyState, PageHeader, buttonClass, clientLabel, cx, humanize } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const client = one(sp.client);
  const assignee = one(sp.assignee);
  const statusParam = one(sp.status) || "open";
  const month = isMonth(one(sp.month)) ? one(sp.month) : "";
  const group = one(sp.group) === "business" ? "business" : "due";
  const flash = one(sp.error) ? { tone: "danger" as const, text: one(sp.error) } : one(sp.added) ? { tone: "ok" as const, text: "Task added." } : one(sp.deleted) ? { tone: "ok" as const, text: "Task deleted." } : one(sp.saved) ? { tone: "ok" as const, text: "Task saved." } : null;

  const where: SQL[] = [];
  if (client === "none") where.push(isNull(schema.tasks.clientId));
  else if (client) where.push(eq(schema.tasks.clientId, client));
  const who = assignee === "me" ? assigneeFor(user) : assignee;
  if (who && (ASSIGNEES as readonly string[]).includes(who)) where.push(eq(schema.tasks.assignee, who as Task["assignee"]));
  if (statusParam === "open") where.push(ne(schema.tasks.status, "done"));
  else if ((TASK_STATUSES as readonly string[]).includes(statusParam)) where.push(eq(schema.tasks.status, statusParam as Task["status"]));
  if (month) where.push(eq(schema.tasks.month, month));

  const db = await getDb();
  const [clients, tasks] = await Promise.all([
    listClients(),
    db
      .select()
      .from(schema.tasks)
      .where(where.length ? and(...where) : undefined)
      .orderBy(sql`${schema.tasks.dueDate} is null`, asc(schema.tasks.dueDate), desc(schema.tasks.createdAt))
      .limit(500),
  ]);
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const nameOf = (t: Task) => (t.clientId ? (names.get(t.clientId) ?? "Archived business") : null);

  // Groups
  const now = today();
  const weekEnd = addDays(now, 6);
  type Group = { key: string; label: string; tone?: "danger" | "warn"; tasks: Task[] };
  let groups: Group[];
  if (group === "business") {
    const byClient = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.clientId ?? "";
      byClient.set(k, [...(byClient.get(k) ?? []), t]);
    }
    const order = [...clients.map((c) => c.id), ...[...byClient.keys()].filter((k) => k && !names.has(k)), ""];
    groups = order
      .filter((k) => byClient.has(k))
      .map((k) => ({ key: k || "none", label: k ? (names.get(k) ?? "Archived business") : "No business", tasks: byClient.get(k)! }));
  } else {
    const buckets: Group[] = [
      { key: "overdue", label: "Overdue", tone: "danger", tasks: [] },
      { key: "today", label: "Today", tone: "warn", tasks: [] },
      { key: "week", label: "Next 7 days", tasks: [] },
      { key: "later", label: "Later", tasks: [] },
      { key: "none", label: "No due date", tasks: [] },
      { key: "done", label: "Done", tasks: [] },
    ];
    const pick = (k: string) => buckets.find((b) => b.key === k)!.tasks;
    for (const t of tasks) {
      if (t.status === "done") pick("done").push(t);
      else if (!t.dueDate) pick("none").push(t);
      else if (t.dueDate < now) pick("overdue").push(t);
      else if (t.dueDate === now) pick("today").push(t);
      else if (t.dueDate <= weekEnd) pick("week").push(t);
      else pick("later").push(t);
    }
    groups = buckets.filter((b) => b.tasks.length);
  }

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { client, assignee, status: statusParam === "open" ? "" : statusParam, month, group: group === "due" ? "" : group };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };
  const returnTo = qs({});
  const filtered = !!(client || assignee || statusParam !== "open" || month);
  const months = [...lastMonths(6, currentMonth()), addMonths(currentMonth(), 1)].reverse();

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Everything on the list across all businesses." />

      {flash && (
        <p role={flash.tone === "danger" ? "alert" : "status"} className={cx("mb-4 rounded-lg px-3 py-2 text-sm", flash.tone === "danger" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>
          {flash.text}
        </p>
      )}

      <Card className="mb-4">
        <TaskQuickAdd
          clients={clients.map((c) => ({ id: c.id, label: clientLabel(c) }))}
          defaultClientId={client && client !== "none" ? client : undefined}
          defaultAssignee={assigneeFor(user)}
          returnTo={returnTo}
        />
      </Card>

      <form method="get" action="/tasks" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
        <div className="col-span-2 sm:col-span-1 lg:col-span-2">
          <label htmlFor="f-client" className="label">Business</label>
          <select id="f-client" name="client" defaultValue={client} className="input">
            <option value="">All businesses</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{clientLabel(c)}</option>
            ))}
            <option value="none">No business</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-assignee" className="label">Assignee</label>
          <select id="f-assignee" name="assignee" defaultValue={assignee} className="input">
            <option value="">Anyone</option>
            <option value="me">Me</option>
            {ASSIGNEES.map((a) => (
              <option key={a} value={a}>{humanize(a)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="label">Status</label>
          <select id="f-status" name="status" defaultValue={statusParam} className="input">
            <option value="open">Not done</option>
            <option value="all">All</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-month" className="label">Month</label>
          <select id="f-month" name="month" defaultValue={month} className="input">
            <option value="">Any month</option>
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>
        <input type="hidden" name="group" value={group === "due" ? "" : group} />
        <div className="flex gap-2">
          <button className={cx(buttonClass("secondary"), "flex-1")}>Filter</button>
          {filtered && (
            <Link href={group === "business" ? "/tasks?group=business" : "/tasks"} className={buttonClass("ghost")}>
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mb-3 flex items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          {tasks.length} task{tasks.length === 1 ? "" : "s"}
          {tasks.length === 500 && " (showing first 500)"}
        </p>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-xs" role="group" aria-label="Group by">
          {(["due", "business"] as const).map((g) => (
            <Link
              key={g}
              href={qs({ group: g === "due" ? "" : g })}
              aria-current={group === g ? "true" : undefined}
              className={cx("rounded-md px-2.5 py-1 font-medium", group === g ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")}
            >
              {g === "due" ? "By due date" : "By business"}
            </Link>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState title={filtered ? "No tasks match these filters." : "Nothing on the list."}>
          {filtered ? "Try clearing the filters." : "Add one above, or open a business and create this month’s checklist from its plan."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <Card
              key={g.key}
              title={
                <span className={cx(g.tone === "danger" && "text-danger", g.tone === "warn" && "text-warn")}>
                  {g.label} <span className="font-normal text-muted">· {g.tasks.length}</span>
                </span>
              }
              actions={
                group === "business" && g.key !== "none" && names.has(g.key) ? (
                  <Link href={`/clients/${g.key}`} className="text-xs font-medium text-accent hover:underline">
                    Business page
                  </Link>
                ) : undefined
              }
              className="overflow-hidden"
              padded={false}
            >
              <div className="px-4">
                <TaskList>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} clientName={nameOf(t)} showClient={group !== "business"} />
                  ))}
                </TaskList>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
