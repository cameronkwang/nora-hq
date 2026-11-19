import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { today } from "@/lib/dates";
import { TaskImport } from "@/components/task-import";
import { PageHeader, clientLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ImportTasksPage() {
  await requireUser();
  const [first] = await listClients();
  const due = new Date(`${today()}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 7);
  return (
    <div className="max-w-3xl">
      <PageHeader
        crumb={<Link href="/tasks">All tasks</Link>}
        title="Import tasks"
        subtitle="Add many tasks at once from a spreadsheet. You’ll see every row before anything is saved."
      />
      <TaskImport exampleBusiness={first ? clientLabel(first) : ""} exampleDue={due.toISOString().slice(0, 10)} />
    </div>
  );
}
