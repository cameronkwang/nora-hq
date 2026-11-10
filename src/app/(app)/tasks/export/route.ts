import { getUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { today } from "@/lib/dates";
import { csvCell } from "../csv";
import { loadTasks, parseTaskFilters, sortTasks } from "../queries";

export const dynamic = "force-dynamic";

/**
 * CSV of the tasks matching the same filters as /tasks (?client=&assignee=&status=&month=&sort=&dir=).
 * The first six columns match /tasks/import, so an export can be edited and imported again.
 */
export async function GET(req: Request) {
  // Middleware already requires a session; check again so this never leaks if the matcher changes.
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const f = parseTaskFilters(new URL(req.url).searchParams);
  const [tasks, clients] = await Promise.all([loadTasks(f, user, 5000), listClients({ includeArchived: true })]);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const label = (id: string | null) => {
    const c = id ? byId.get(id) : undefined;
    return c ? (c.location ? `${c.name} · ${c.location}` : c.name) : "";
  };
  const sorted = sortTasks(tasks, f, (t) => label(t.clientId) || null);

  const header = ["title", "business", "due", "assignee", "platform", "details", "status", "month", "created_by", "created_at", "completed_at", "id"];
  const lines = [header.map(csvCell).join(",")];
  for (const t of sorted) {
    lines.push(
      [
        t.title, label(t.clientId), t.dueDate, t.assignee === "unassigned" ? "" : t.assignee, t.platform, t.details,
        t.status, t.month, t.createdBy, t.createdAt.toISOString(), t.completedAt?.toISOString() ?? "", t.id,
      ].map(csvCell).join(","),
    );
  }

  const suffix = f.client && byId.has(f.client) ? `-${f.client}` : "";
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tasks${suffix}-${today()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
