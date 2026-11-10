import { quickAddTask } from "@/app/(app)/tasks/actions";
import { ASSIGNEES, PLATFORMS } from "@/lib/schema";
import { Button, humanize } from "./ui";

type Opt = { id: string; label: string };

/** Quick-add task form. Plain server-action form; the browser resets it after a successful add. */
export function TaskQuickAdd({
  clients,
  defaultClientId,
  defaultAssignee,
  returnTo,
  askId,
}: {
  clients: Opt[];
  defaultClientId?: string;
  defaultAssignee?: string;
  returnTo: string;
  askId?: string;
}) {
  const assignee = defaultAssignee && (ASSIGNEES as readonly string[]).includes(defaultAssignee) ? defaultAssignee : "unassigned";
  return (
    <form action={quickAddTask} className="grid grid-cols-2 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9rem_7rem_7rem_auto] xl:items-end">
      <input type="hidden" name="returnTo" value={returnTo} />
      {askId && <input type="hidden" name="askId" value={askId} />}
      <div className="col-span-2 xl:col-span-1">
        <label htmlFor="qa-title" className="label">New task</label>
        <input id="qa-title" name="title" required placeholder="What needs doing?" className="input" autoComplete="off" />
      </div>
      <div className="col-span-2 xl:col-span-1">
        <label htmlFor="qa-client" className="label">Business</label>
        <select id="qa-client" name="clientId" defaultValue={defaultClientId ?? ""} className="input">
          <option value="">No business</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="xl:col-span-1">
        <label htmlFor="qa-due" className="label">Due</label>
        <input id="qa-due" name="dueDate" type="date" className="input" />
      </div>
      <div className="xl:col-span-1">
        <label htmlFor="qa-assignee" className="label">Who</label>
        <select id="qa-assignee" name="assignee" defaultValue={assignee} className="input">
          {ASSIGNEES.map((a) => (
            <option key={a} value={a}>{humanize(a)}</option>
          ))}
        </select>
      </div>
      <div className="xl:col-span-1">
        <label htmlFor="qa-platform" className="label">Platform</label>
        <select id="qa-platform" name="platform" defaultValue="" className="input">
          <option value="">—</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p === "tiktok" ? "TikTok" : humanize(p)}</option>
          ))}
        </select>
      </div>
      <div className="self-end xl:col-span-1">
        <Button type="submit" variant="primary" className="w-full">Add</Button>
      </div>
    </form>
  );
}
