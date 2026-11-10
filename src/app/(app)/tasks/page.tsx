import { PhoneDisclosure } from "@/components/phone-disclosure";
import Link from "next/link";
import { cookies } from "next/headers";
import { assigneeFor, requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { addMonths, currentMonth, lastMonths, monthLabel, today } from "@/lib/dates";
import type { Task } from "@/lib/schema";
import { TaskList, TaskRow } from "@/components/task-row";
import { TaskQuickAdd } from "@/components/task-quick-add";
import { TaskFilters } from "@/components/task-filters";
import { TaskMenu } from "@/components/task-menu";
import { TaskSelection, TaskSelectAll, TaskSelectToggle } from "@/components/task-selection";
import { TaskTable, type TaskLite } from "@/components/task-table";
import { BoardView } from "@/components/board-view";
import { ViewToggle } from "@/components/view-toggle";
import { Card, EmptyState, PageHeader, clientLabel, cx } from "@/components/ui";
import {
  BOARD_DONE_DAYS, SORT_KEYS, VIEWS, isFiltered, loadBoardTasks, loadTasks, parseTaskFilters, sortTasks, tasksHref, viewCookieName,
} from "./queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const VIEW_LABEL = { list: "List", board: "Board", table: "Table" } as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const cookieName = viewCookieName(user);
  const f = parseTaskFilters(sp, (await cookies()).get(cookieName)?.value);

  const imported = Number(one(sp.imported)) || 0;
  const flash = one(sp.error)
    ? { tone: "danger" as const, text: one(sp.error) }
    : imported
      ? { tone: "ok" as const, text: `Imported ${imported} task${imported === 1 ? "" : "s"}.` }
      : one(sp.added)
        ? { tone: "ok" as const, text: "Task added." }
        : one(sp.deleted)
          ? { tone: "ok" as const, text: "Task deleted." }
          : one(sp.saved)
            ? { tone: "ok" as const, text: "Task saved." }
            : null;

  const [clients, data] = await Promise.all([
    listClients(),
    f.view === "board" ? loadBoardTasks(f, user) : loadTasks(f, user).then((tasks) => ({ tasks, olderDone: 0 })),
  ]);
  const tasks = data.tasks;
  const names = new Map(clients.map((c) => [c.id, clientLabel(c)]));
  const nameOf = (t: Task) => (t.clientId ? (names.get(t.clientId) ?? "Archived business") : null);
  const lite = (t: Task): TaskLite => ({
    id: t.id, title: t.title, clientId: t.clientId, clientName: nameOf(t), status: t.status,
    assignee: t.assignee, dueDate: t.dueDate, platform: t.platform, month: t.month,
  });
  const clientOpts = clients.map((c) => ({ id: c.id, label: clientLabel(c) }));

  const returnTo = tasksHref(f);
  const filtered = isFiltered(f);
  const now = today();
  const months = [...lastMonths(6, currentMonth()), addMonths(currentMonth(), 1)].reverse().map((m) => ({ value: m, label: monthLabel(m) }));
  const exportHref = tasksHref({ ...f, view: "list", group: "due" }, {}, "/tasks/export");
  const shown = tasks.length;
  const clearHref = tasksHref({ ...f, client: "", assignee: "", status: "open", month: "" });

  let body: React.ReactNode;
  if (shown === 0 && f.view !== "board") {
    body = (
      <EmptyState title={filtered ? "No tasks match these filters." : "Nothing on the list."}>
        {filtered ? (
          <Link href={clearHref} className="text-accent hover:underline">Clear filters</Link>
        ) : (
          "Add one above, or open a business and create this month’s checklist from its plan."
        )}
      </EmptyState>
    );
  } else if (f.view === "board") {
    body = (
      <BoardView
        tasks={tasks.map(lite)}
        today={now}
        olderDone={data.olderDone}
        olderDoneHref={tasksHref({ ...f, view: "list" }, { status: "done" })}
        doneDays={BOARD_DONE_DAYS}
      />
    );
  } else if (f.view === "table") {
    const rows = sortTasks(tasks, f, nameOf).map(lite);
    const sortHrefs: Record<string, string> = {};
    for (const k of SORT_KEYS) for (const d of ["asc", "desc"] as const) sortHrefs[`${k}:${d}`] = tasksHref(f, { sort: k === "due" ? "" : k, dir: d === "asc" ? "" : d });
    body = (
      <TaskSelection ids={rows.map((r) => r.id)} alwaysOn>
        <TaskTable rows={rows} clients={clientOpts} sort={f.sort} dir={f.dir} sortHrefs={sortHrefs} today={now} />
      </TaskSelection>
    );
  } else {
    body = <ListBody tasks={tasks} f={f} clients={clients} names={names} nameOf={nameOf} now={now} />;
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={
          <>
            {shown} {f.view === "board" ? "on the board" : `task${shown === 1 ? "" : "s"}`}
            {shown === 500 && " (showing first 500)"}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle
              cookieName={cookieName}
              current={f.view}
              options={VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v], href: tasksHref({ ...f, view: v }, { view: v }) }))}
            />
            <TaskMenu
              items={[
                { label: "Export CSV", hint: "The tasks matching these filters", href: exportHref, download: true },
                { label: "Import CSV", hint: "Add many tasks from a spreadsheet", href: "/tasks/import" },
              ]}
            />
          </div>
        }
      />

      {flash && (
        <p role={flash.tone === "danger" ? "alert" : "status"} className={cx("mb-4 rounded-lg px-3 py-2 text-sm", flash.tone === "danger" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>
          {flash.text}
        </p>
      )}

      <Card className="mb-4">
        <PhoneDisclosure summary="New task">
        <TaskQuickAdd
          clients={clientOpts}
          defaultClientId={f.client && f.client !== "none" ? f.client : undefined}
          defaultAssignee={assigneeFor(user)}
          returnTo={returnTo}
        />
        </PhoneDisclosure>
      </Card>

      <TaskFilters
        view={f.view}
        client={f.client}
        assignee={f.assignee}
        status={f.status}
        month={f.month}
        group={f.group}
        sort={f.sort}
        dir={f.dir}
        clients={clientOpts}
        months={months}
        mineHref={tasksHref(f, { assignee: f.assignee === "me" ? "" : "me" })}
        clearHref={clearHref}
        filtered={filtered}
      />

      {body}
    </div>
  );
}

function ListBody({
  tasks, f, clients, names, nameOf, now,
}: {
  tasks: Task[];
  f: ReturnType<typeof parseTaskFilters>;
  clients: Array<{ id: string }>;
  names: Map<string, string>;
  nameOf: (t: Task) => string | null;
  now: string;
}) {
  const weekEnd = addDays(now, 6);
  type Group = { key: string; label: string; tone?: "danger" | "warn"; tasks: Task[] };
  let groups: Group[];
  if (f.group === "business") {
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

  return (
    <TaskSelection ids={tasks.map((t) => t.id)}>
      <div className="mb-2 flex min-h-11 items-center justify-between gap-2">
        <TaskSelectAll />
        <span className="ml-auto">
          <TaskSelectToggle />
        </span>
      </div>
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
              f.group === "business" && g.key !== "none" && names.has(g.key) ? (
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
                  <TaskRow key={t.id} task={t} clientName={nameOf(t)} showClient={f.group !== "business"} selectable />
                ))}
              </TaskList>
            </div>
          </Card>
        ))}
      </div>
    </TaskSelection>
  );
}
