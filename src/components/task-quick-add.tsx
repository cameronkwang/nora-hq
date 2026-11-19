import { quickAddTask } from "@/app/(app)/tasks/actions";
import { ASSIGNEES, PLATFORMS } from "@/lib/schema";
import { Button, humanize } from "./ui";

type Opt = { id: string; label: string };

/** Quick-add task form. Plain server-action form; the browser resets it after a successful add. The Add button is
 * secondary: the screen's one primary is "New ask". */
export function TaskQuickAdd({
  clients,
  defaultClientId,
  defaultAssignee,
  returnTo,
  askId,
  label = "New task",
}: {
  clients: Opt[];
  defaultClientId?: string;
  defaultAssignee?: string;
  returnTo: string;
  askId?: string;
  /** Label over the title field. */
  label?: string;
}) {
  const assignee = defaultAssignee && (ASSIGNEES as readonly string[]).includes(defaultAssignee) ? defaultAssignee : "unassigned";
  return (
    // The layout follows the form's own width, not the window's: /tasks has room for one row, the ask page's side
    // column (about 300px) gets the two-column stack.
    <div className="@container">
    <form action={quickAddTask} className="grid grid-cols-2 gap-3 @lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] @lg:items-end @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9rem_7rem_7rem_auto]">
      <input type="hidden" name="returnTo" value={returnTo} />
      {askId && <input type="hidden" name="askId" value={askId} />}
      <div className="col-span-2 @4xl:col-span-1">
        <label htmlFor="qa-title" className="label">{label}</label>
        <input id="qa-title" name="title" required placeholder="What needs doing?" className="input" autoComplete="off" />
      </div>
      <div className="col-span-2 @4xl:col-span-1">
        <label htmlFor="qa-client" className="label">Business</label>
        <select id="qa-client" name="clientId" defaultValue={defaultClientId ?? ""} className="input">
          <option value="">No business</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="@4xl:col-span-1">
        <label htmlFor="qa-due" className="label">Due</label>
        <input id="qa-due" name="dueDate" type="date" className="input" />
      </div>
      <div className="@4xl:col-span-1">
        <label htmlFor="qa-assignee" className="label">Who</label>
        <select id="qa-assignee" name="assignee" defaultValue={assignee} className="input">
          {ASSIGNEES.map((a) => (
            <option key={a} value={a}>{humanize(a)}</option>
          ))}
        </select>
      </div>
      <div className="@4xl:col-span-1">
        <label htmlFor="qa-platform" className="label">Platform</label>
        <select id="qa-platform" name="platform" defaultValue="" className="input">
          <option value="">None</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p === "tiktok" ? "TikTok" : humanize(p)}</option>
          ))}
        </select>
      </div>
      <div className="self-end @4xl:col-span-1">
        <Button type="submit" className="w-full">Add</Button>
      </div>
    </form>
    </div>
  );
}
