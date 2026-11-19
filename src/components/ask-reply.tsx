"use client";

import { useActionState, useEffect, useRef, type CSSProperties } from "react";
import { replyToAskAction, type AskReplyState } from "@/app/(app)/asks/actions";
import { buttonClass } from "./ui";

/**
 * Reply box at the bottom of an ask's conversation. Sticks above the phone tab bar while the
 * conversation is on screen (a solid paper bar with a hairline on top). Enter adds a new line; ⌘/Ctrl+Enter sends.
 */
export function AskReply({ askId, placeholder }: { askId: string; placeholder: string }) {
  const [state, action, pending] = useActionState<AskReplyState, FormData>(replyToAskAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="ask-bar">
      <input type="hidden" name="id" value={askId} />
      <label htmlFor="ask-reply" className="sr-only">
        Reply
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="ask-reply"
          name="body"
          required
          rows={2}
          maxLength={4000}
          placeholder={placeholder}
          readOnly={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="input composer-input min-w-0 flex-1"
          // Grows with the text where supported (fieldSizing); rows=2 elsewhere.
          style={{ maxHeight: "40vh", fieldSizing: "content" } as CSSProperties}
        />
        {/* Outlined, like every action on an ask: the accent stays with "New ask" and the counts. */}
        <button type="submit" disabled={pending} className={buttonClass("secondary")}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="status is-danger mt-2 whitespace-normal">
          {state.error}
        </p>
      )}
    </form>
  );
}
