"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { approveDraftAction, markSentAction, rejectDraftAction, saveDraftAction, sendReportAction } from "@/app/(app)/review/actions";
import { countHashtags, draftWarnings, textLimit } from "./draft-checks";
import { CopyButton } from "./copy-button";
import { ConfirmButton } from "./client-form";
import { Markdown } from "./draft-markdown";
import { useDraftQueue } from "./draft-queue";
import { ReplyPicker } from "./reply-picker";
import type { ReplyCategory, ReplyContext } from "./reply-fill";
import { Badge, buttonClass, cx } from "./ui";

type Mode = "review" | "failed" | "approved" | "readonly";

/** Kinds where a saved reply makes sense (not post captions or reports). */
const REPLY_KINDS = ["review_reply", "outreach_email", "outreach_dm", "lead_email", "lead_dm", "comment_reply", "other"];

export type ReportInfo = { reportId: string | null; clientId: string | null; audience: "internal" | "external"; ownerEmail: string | null; month?: string | null };

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
 *  approved → Copy / open links / Save edit / Mark sent (reports: Send to owner)
 *  readonly → text only (+ Copy)
 * Inside a <DraftQueue> (Needs review list) approving and sending back happen without a page reload, and on phones
 * the current card gets a fixed bottom bar: Send back / Edit / Approve.
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
  replyContext,
  replyCategory,
  report,
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
  /** Fills {name} {business} {date} {link} in saved replies. */
  replyContext?: ReplyContext;
  replyCategory?: ReplyCategory;
  /** kind "report": who it's for and where it can be sent. */
  report?: ReportInfo;
}) {
  const [body, setBody] = useState(initial);
  const isReport = kind === "report";
  const [editOpen, setEditOpen] = useState(!isReport);
  const taId = `draft-body-${id}`;
  const ta = useRef<HTMLTextAreaElement>(null);
  const sel = useRef<{ start: number; end: number } | null>(null);
  const sendBack = useRef<HTMLDetailsElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const lim = textLimit(kind, meta);
  const warnings = draftWarnings(kind, body, meta);
  const dirty = body !== initial;
  const tags = kind === "instagram_post" ? countHashtags(body) : null;
  // Things the platform itself would reject. (FTC warnings are shown loudly but left to the person.)
  const hardBlock = (!!lim && lim.hard && body.length > lim.max) || (tags !== null && tags > 30);
  const readOnly = mode === "readonly";

  const queue = useDraftQueue();
  const inQueue = !!queue && mode === "review";
  const busy = !!queue && queue.busyId === id;
  const phoneBar = inQueue && queue.focusMode && queue.isCurrent(id);

  // Latest values for the queue's keyboard / bulk handlers.
  const latest = useRef({ body, hardBlock, postKey });
  latest.current = { body, hardBlock, postKey };

  function focusEdit() {
    setEditOpen(true);
    window.setTimeout(() => {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }
  function openSendBack() {
    const d = sendBack.current;
    if (!d) return;
    d.open = true;
    window.setTimeout(() => {
      note.current?.focus({ preventScroll: true });
      d.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }

  const register = queue?.register;
  useEffect(() => {
    if (!register || mode !== "review") return;
    return register(id, {
      snapshot: () => ({ body: latest.current.body, blocked: latest.current.hardBlock, postKey: latest.current.postKey }),
      focusEdit,
      openSendBack,
    });
  }, [register, id, mode]);

  function insertReply(text: string) {
    const cur = ta.current?.value ?? body;
    const s = sel.current;
    let next: string;
    let caret: number;
    if (s && s.start <= cur.length) {
      next = cur.slice(0, s.start) + text + cur.slice(s.end);
      caret = s.start + text.length;
    } else {
      const sep = cur.trim() ? (cur.endsWith("\n\n") ? "" : cur.endsWith("\n") ? "\n" : "\n\n") : "";
      next = (cur.trim() ? cur : "") + sep + text;
      caret = next.length;
    }
    setBody(next);
    setEditOpen(true);
    window.setTimeout(() => {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(caret, caret);
      sel.current = { start: caret, end: caret };
    }, 0);
  }

  const showPicker = !readOnly && REPLY_KINDS.includes(kind);
  const canSendReport = isReport && mode === "approved" && report?.audience !== "internal" && !!report?.ownerEmail && !!report.reportId;

  const textarea = (
    <div>
      <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={taId} className="label !mb-0">
          {readOnly ? "Text" : isReport ? "Report text (markdown)" : "Text (edit before approving if needed)"}
        </label>
        {showPicker && <ReplyPicker context={replyContext} category={replyCategory} onPick={insertReply} size="sm" variant="ghost" className="-my-1" />}
      </div>
      <textarea
        ref={ta}
        id={taId}
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSelect={(e) => {
          const t = e.currentTarget;
          sel.current = { start: t.selectionStart, end: t.selectionEnd };
        }}
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
  );

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {postKey && <input type="hidden" name="postKey" value={postKey} />}

        {isReport ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {report?.audience === "internal" ? <Badge tone="neutral">Internal — Cameron &amp; Nora only</Badge> : <Badge tone="info">Owner-facing</Badge>}
              {report?.audience !== "internal" &&
                (report?.ownerEmail ? (
                  <span className="text-muted">Goes to {report.ownerEmail} only when you click Send.</span>
                ) : (
                  <span className="text-muted">
                    No owner email saved
                    {report?.clientId && (
                      <>
                        {" — "}
                        <Link href={`/clients/${report.clientId}`} className="text-accent hover:underline">add it on the business page</Link>
                      </>
                    )}
                    .
                  </span>
                ))}
            </div>
            <div className="rounded-lg border border-border bg-bg px-4 py-3" aria-label="Report preview">
              {body.trim() ? <Markdown source={body} /> : <p className="text-sm text-muted">(empty)</p>}
            </div>
            <details open={editOpen} onToggle={(e) => setEditOpen(e.currentTarget.open)} className="rounded-lg border border-border">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted hover:text-text pointer-coarse:min-h-11 pointer-coarse:py-3">
                {readOnly ? "Show text" : "Edit text"}
              </summary>
              <div className="border-t border-border p-3">{textarea}</div>
            </details>
          </>
        ) : (
          textarea
        )}

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

        <div className={cx("flex flex-wrap items-center gap-2", phoneBar && "max-md:hidden")}>
          {mode === "review" &&
            (inQueue ? (
              <>
                <button type="button" onClick={() => queue.approve(id)} disabled={hardBlock || busy} className={cx(buttonClass("primary"), "grow sm:grow-0")}>
                  {busy ? "Approving…" : dirty ? "Approve with edits" : "Approve"}
                </button>
                <ActionButton action={saveDraftAction} pendingText="Saving…" disabled={!dirty}>
                  Save edit
                </ActionButton>
              </>
            ) : (
              <>
                <ActionButton action={approveDraftAction} variant="primary" pendingText="Approving…" disabled={hardBlock} className="grow sm:grow-0">
                  {dirty ? "Approve with edits" : "Approve"}
                </ActionButton>
                <ActionButton action={saveDraftAction} pendingText="Saving…" disabled={!dirty}>
                  Save edit
                </ActionButton>
              </>
            ))}
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
              {canSendReport &&
                (dirty ? (
                  <button type="button" disabled className={buttonClass("primary")}>Send to owner</button>
                ) : (
                  <ConfirmButton formAction={sendReportAction} confirm={`Email this report to ${report!.ownerEmail}?`} variant="primary" size="md">
                    Send to owner
                  </ConfirmButton>
                ))}
              <CopyButton targetId={taId} label="Copy text" variant={canSendReport ? "secondary" : "primary"} />
              {mailto && (
                <a
                  href={`mailto:${encodeURIComponent(mailto.to)}?subject=${encodeURIComponent(mailto.subject)}&body=${encodeURIComponent(body)}`}
                  className={buttonClass("secondary")}
                >
                  Open in email app
                </a>
              )}
              {links}
              <ActionButton action={markSentAction} pendingText="Saving…" variant={canSendReport ? "ghost" : "secondary"}>
                {isReport ? (report?.audience === "internal" ? "Mark done" : "Mark sent (sent it myself)") : kind === "profile_copy" ? "Mark done (pasted it in)" : "Mark sent"}
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
        {canSendReport && dirty && <p className="text-xs text-warn">Save your edit before sending — the owner gets the saved version.</p>}
        {hardBlock && mode !== "readonly" && <p className="text-xs text-danger">Fix the problem above to approve.</p>}
      </form>

      {mode === "review" && (
        <details ref={sendBack} className="group rounded-lg border border-border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted hover:text-text pointer-coarse:min-h-11 pointer-coarse:py-3">Send back to Claude…</summary>
          <form
            action={inQueue ? undefined : rejectDraftAction}
            onSubmit={(e) => {
              if (!inQueue) return;
              e.preventDefault();
              void queue.reject(id, note.current?.value ?? "");
            }}
            className="flex flex-col gap-2 border-t border-border p-3"
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label htmlFor={`note-${id}`} className="label">
              What should change?
            </label>
            <textarea ref={note} id={`note-${id}`} name="note" rows={3} className="input" placeholder="e.g. Too formal. Mention the new mango bowl and keep it under 3 lines." />
            <p className="text-xs text-muted">Claude reads your note and sends a new version the next time it checks the queue.</p>
            <div>
              {inQueue ? (
                <button type="submit" disabled={busy} className={buttonClass("danger")}>
                  {busy ? "Sending back…" : "Send back"}
                </button>
              ) : (
                <ActionButton action={rejectDraftAction} variant="danger" pendingText="Sending back…">
                  Send back
                </ActionButton>
              )}
            </div>
          </form>
        </details>
      )}

      {phoneBar && (
        <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-20 border-t border-border bg-surface/95 px-4 py-2 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-2">
            <button type="button" onClick={openSendBack} disabled={busy} className={cx(buttonClass("secondary"), "px-3")}>
              Send back
            </button>
            <button type="button" onClick={focusEdit} disabled={busy} className={cx(buttonClass("secondary"), "px-3")}>
              Edit
            </button>
            <button type="button" onClick={() => queue.approve(id)} disabled={hardBlock || busy} className={cx(buttonClass("primary"), "grow")}>
              {busy ? "Approving…" : dirty ? "Approve edits" : "Approve"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
