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
    { to: "new", label: "Not started" },
  ],
  done: [
    { to: "in_progress", label: "Reopen" },
    { to: "archived", label: "Archive" },
  ],
  archived: [{ to: "new", label: "Restore" }],
};

/**
 * Small forms that move an ask between statuses. The main move is outlined and the rest are quiet text buttons:
 * moving an ask along is housekeeping, so none of them takes the accent.
 */
export function AskStatusButtons({ id, status }: { id: string; status: AskStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {MOVES[status].map((m) => (
        <form key={m.to} action={setAskStatus}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={m.to} />
          <button className={buttonClass(m.primary ? "secondary" : "ghost", "sm")}>{m.label}</button>
        </form>
      ))}
    </div>
  );
}
