import type { ReactNode } from "react";

export type ThreadItem = { id: string; claude: boolean; who: string; body: string; when?: string; whenTitle?: string };

/**
 * The conversation on an ask, as a transcript: who and when on one line, then the words, a hairline between
 * messages. Claude's lines carry a small ink dot, so its words are easy to tell from people's.
 */
export function AskThread({ items, empty }: { items: ThreadItem[]; empty?: ReactNode }) {
  if (!items.length) return empty ? <p className="sec-note">{empty}</p> : null;
  return (
    <ol aria-label="Conversation" className="list ask-thread">
      {items.map((m) => (
        <li key={m.id}>
          <p className="ask-who">
            {m.claude ? (
              <span className="status is-ink is-small">
                <b>{m.who}</b>
              </span>
            ) : (
              <b>{m.who}</b>
            )}
            {m.when && (
              <time className="text-muted" title={m.whenTitle}>
                {m.when}
              </time>
            )}
          </p>
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
