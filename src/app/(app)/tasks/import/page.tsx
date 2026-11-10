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
    <div className="mx-auto max-w-3xl">
      <Link href="/tasks" className="mb-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-text md:min-h-0">
        ← All tasks
      </Link>
      <PageHeader title="Import tasks" subtitle="Add many tasks at once from a spreadsheet. You’ll see every row before anything is saved." />
      <TaskImport exampleBusiness={first ? clientLabel(first) : ""} exampleDue={due.toISOString().slice(0, 10)} />
    </div>
  );
}
