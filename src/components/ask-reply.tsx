"use client";

import { useActionState, useEffect, useRef, type CSSProperties } from "react";
import { replyToAskAction, type AskReplyState } from "@/app/(app)/asks/actions";
import { buttonClass } from "./ui";

/**
 * Reply box at the bottom of an ask's conversation. Sticks above the phone tab bar while the
 * conversation is on screen. Enter adds a new line; ⌘/Ctrl+Enter sends.
 */
export function AskReply({ askId, placeholder }: { askId: string; placeholder: string }) {
  const [state, action, pending] = useActionState<AskReplyState, FormData>(replyToAskAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  return (
    <form
      ref={formRef}
      action={action}
      className="sticky bottom-[calc(var(--tabbar-h)+0.5rem)] z-20 rounded-2xl border border-border bg-surface p-2 shadow-lg focus-within:ring-2 focus-within:ring-accent md:bottom-4 md:shadow-sm"
    >
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
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base text-text outline-none placeholder:text-muted"
          // Grows with the text where supported (fieldSizing); rows=2 elsewhere.
          style={{ minHeight: "2.75rem", maxHeight: "40vh", fieldSizing: "content" } as CSSProperties}
        />
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="px-2 pt-1 text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
