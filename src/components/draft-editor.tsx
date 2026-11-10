"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { approveDraftAction, markSentAction, rejectDraftAction, saveDraftAction } from "@/app/(app)/review/actions";
import { countHashtags, draftWarnings, textLimit } from "./draft-checks";
import { CopyButton } from "./copy-button";
import { buttonClass, cx } from "./ui";

type Mode = "review" | "failed" | "approved" | "readonly";

function ActionButton({
  action,
  children,
  pendingText,
  variant = "secondary",
  disabled,
  className,
}: {
  action: (fd: FormData) => Promise<void>;
  children: ReactNode;
  pendingText: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  const status = useFormStatus();
  const mine = status.pending && status.action === action;
  return (
    <button type="submit" formAction={action} disabled={disabled || status.pending} className={cx(buttonClass(variant), className)}>
      {mine ? pendingText : children}
    </button>
  );
}

/**
 * Editable draft body + the actions that apply in this mode.
 *  review   → Approve (with edited text) / Save edit / Send back
 *  failed   → Retry (approve again) / Save edit
 *  approved → Copy / open links / Save edit / Mark sent
 *  readonly → text only (+ Copy)
 */
export function DraftEditor({
  id,
  kind,
  meta,
  body: initial,
  mode,
  returnTo,
  mailto,
  links,
  postKey,
}: {
  id: string;
  kind: string;
  meta: Record<string, unknown>;
  body: string;
  mode: Mode;
  returnTo: string;
  /** For approved outreach emails without Gmail: builds a mailto: link from the current text. */
  mailto?: { to: string; subject: string };
  /** Extra links (open profile, open Google Maps, ...) shown next to the buttons. */
  links?: ReactNode;
  /** Post drafts: fingerprint of the calendar post as shown, so approval is refused if it changed since. */
  postKey?: string;
}) {
  const [body, setBody] = useState(initial);
  const taId = `draft-body-${id}`;
  const lim = textLimit(kind, meta);
  const warnings = draftWarnings(kind, body, meta);
  const dirty = body !== initial;
  const tags = kind === "instagram_post" ? countHashtags(body) : null;
  // Things the platform itself would reject. (FTC warnings are shown loudly but left to the person.)
  const hardBlock = (!!lim && lim.hard && body.length > lim.max) || (tags !== null && tags > 30);
  const readOnly = mode === "readonly";

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {postKey && <input type="hidden" name="postKey" value={postKey} />}
        <div>
          <label htmlFor={taId} className="label">
            {readOnly ? "Text" : "Text (edit before approving if needed)"}
          </label>
          <textarea
            id={taId}
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            readOnly={readOnly}
            rows={Math.min(16, Math.max(5, body.split("\n").length + 1))}
            className={cx("input font-[inherit] leading-relaxed", readOnly && "bg-surface-2")}
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
            <span>
              {dirty && !readOnly ? <span className="font-medium text-warn">Unsaved changes · </span> : null}
              {tags !== null && <span className={cx(tags > 30 && "font-semibold text-danger")}>{tags} hashtag{tags === 1 ? "" : "s"} (30 max) · </span>}
            </span>
            {lim ? (
              <span className={cx("tabular-nums", body.length > lim.max ? "font-semibold text-danger" : body.length > lim.max * 0.9 ? "text-warn" : "")}>
                {body.length.toLocaleString("en-US")} / {lim.max.toLocaleString("en-US")}
              </span>
            ) : (
              <span className="tabular-nums">{body.length.toLocaleString("en-US")} characters</span>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {warnings.map((w) => (
              <li key={w.text} role={w.tone === "danger" ? "alert" : undefined} className={cx("rounded-lg px-3 py-2 text-sm", w.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>
                {w.tone === "danger" ? "Stop: " : "Check: "}
                {w.text}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {mode === "review" && (
            <>
              <ActionButton action={approveDraftAction} variant="primary" pendingText="Approving…" disabled={hardBlock} className="grow sm:grow-0">
                {dirty ? "Approve with edits" : "Approve"}
              </ActionButton>
              <ActionButton action={saveDraftAction} pendingText="Saving…" disabled={!dirty}>
                Save edit
              </ActionButton>
            </>
          )}
          {mode === "failed" && (
            <>
              <ActionButton action={approveDraftAction} variant="primary" pendingText="Retrying…" disabled={hardBlock} className="grow sm:grow-0">
                Retry
              </ActionButton>
              <ActionButton action={saveDraftAction} pendingText="Saving…" disabled={!dirty}>
                Save edit
              </ActionButton>
            </>
          )}
          {mode === "approved" && (
            <>
              <CopyButton targetId={taId} label="Copy text" variant="primary" />
              {mailto && (
                <a
                  href={`mailto:${encodeURIComponent(mailto.to)}?subject=${encodeURIComponent(mailto.subject)}&body=${encodeURIComponent(body)}`}
                  className={buttonClass("secondary")}
                >
                  Open in email app
                </a>
              )}
              {links}
              <ActionButton action={markSentAction} pendingText="Saving…">
                Mark sent
              </ActionButton>
              {dirty && (
                <ActionButton action={saveDraftAction} pendingText="Saving…" variant="ghost">
                  Save edit
                </ActionButton>
              )}
            </>
          )}
          {mode === "readonly" && <CopyButton targetId={taId} label="Copy text" size="sm" />}
        </div>
        {hardBlock && mode !== "readonly" && <p className="text-xs text-danger">Fix the problem above to approve.</p>}
      </form>

      {mode === "review" && (
        <details className="group rounded-lg border border-border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted hover:text-text">Send back to Claude…</summary>
          <form action={rejectDraftAction} className="flex flex-col gap-2 border-t border-border p-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label htmlFor={`note-${id}`} className="label">
              What should change?
            </label>
            <textarea id={`note-${id}`} name="note" rows={3} className="input" placeholder="e.g. Too formal. Mention the new mango bowl and keep it under 3 lines." />
            <p className="text-xs text-muted">Claude reads your note and sends a new version the next time it checks the queue.</p>
            <div>
              <ActionButton action={rejectDraftAction} variant="danger" pendingText="Sending back…">
                Send back
              </ActionButton>
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
