import { setAskStatus } from "@/app/(app)/asks/actions";
import type { AskStatus } from "@/lib/schema";
import { buttonClass } from "./ui";

const MOVES: Record<AskStatus, Array<{ to: AskStatus; label: string; primary?: boolean }>> = {
  new: [
    { to: "in_progress", label: "Start", primary: true },
    { to: "done", label: "Mark done" },
    { to: "archived", label: "Archive" },
  ],
  in_progress: [
    { to: "done", label: "Mark done", primary: true },
    { to: "new", label: "Back to new" },
  ],
  done: [
    { to: "in_progress", label: "Reopen" },
    { to: "archived", label: "Archive" },
  ],
  archived: [{ to: "new", label: "Restore" }],
};

/** Small forms that move an ask between statuses. */
export function AskStatusButtons({ id, status }: { id: string; status: AskStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {MOVES[status].map((m) => (
        <form key={m.to} action={setAskStatus}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={m.to} />
          <button className={buttonClass(m.primary ? "primary" : "secondary", "sm")}>{m.label}</button>
        </form>
      ))}
    </div>
  );
}
