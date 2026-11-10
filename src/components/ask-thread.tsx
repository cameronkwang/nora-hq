import type { ReactNode } from "react";
import { cx } from "./ui";

export type ThreadItem = { id: string; claude: boolean; who: string; body: string; when?: string; whenTitle?: string };

/** Chat-style conversation on an ask: Claude on the left, people on the right. */
export function AskThread({ items, empty }: { items: ThreadItem[]; empty?: ReactNode }) {
  if (!items.length) return empty ? <p className="px-1 text-sm text-muted">{empty}</p> : null;
  return (
    <ol aria-label="Conversation" className="flex flex-col gap-3">
      {items.map((m) => (
        <li key={m.id} className={cx("flex flex-col", m.claude ? "items-start" : "items-end")}>
          <div
            className={cx(
              "max-w-[92%] rounded-2xl px-4 py-2.5 sm:max-w-[80%]",
              m.claude ? "rounded-tl-sm border-l-4 border-accent bg-accent-soft" : "rounded-tr-sm bg-surface-2",
            )}
          >
            <p className={cx("mb-0.5 text-xs font-semibold", m.claude ? "text-accent" : "text-muted")}>{m.who}</p>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.body}</p>
          </div>
          {m.when && (
            <time className="mt-1 px-1 text-xs text-muted" title={m.whenTitle}>
              {m.when}
            </time>
          )}
        </li>
      ))}
    </ol>
  );
}
