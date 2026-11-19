"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadPickerRepliesAction, recordReplyUseAction, type PickerReply } from "@/app/(app)/replies/actions";
import { copyText } from "./copy-button";
import { REPLY_CATEGORIES, REPLY_CATEGORY_LABEL, fillReply, missingPlaceholders, type ReplyCategory, type ReplyContext } from "./reply-fill";
import { buttonClass, cx } from "./ui";

/**
 * "Replies" button → sheet (phone) / dialog (desktop) of saved replies with {name} {business} {date} {link}
 * filled from `context`. With `onPick` each reply gets "Insert" (hands the filled text to the caller);
 * without it (e.g. on a server-rendered page) the replies are copied to the clipboard.
 */
export function ReplyPicker({
  context,
  onPick,
  category,
  label = "Replies",
  variant = "secondary",
  size = "md",
  className,
}: {
  context?: ReplyContext;
  onPick?: (text: string) => void;
  /** Category to show first (the filter starts on it if it has any replies). */
  category?: ReplyCategory;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [replies, setReplies] = useState<PickerReply[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ReplyCategory | "">("");
  const [copied, setCopied] = useState<string | null>(null);
  const titleId = useId();
  // The dialog is portalled to <body> so it never sits inside the caller's <form> (Enter in the search box
  // must not submit — and approve — a draft).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function open() {
    dialog.current?.showModal();
    setError(null);
    setCopied(null);
    try {
      const rows = await loadPickerRepliesAction();
      setReplies(rows);
      if (category && rows.some((r) => r.category === category)) setCat(category);
    } catch {
      setError("Couldn't load saved replies. Check your connection and try again.");
    }
  }
  const close = () => dialog.current?.close();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (replies ?? []).filter(
      (r) => (!cat || r.category === cat) && (!needle || r.title.toLowerCase().includes(needle) || r.body.toLowerCase().includes(needle)),
    );
  }, [replies, q, cat]);

  const presentCats = REPLY_CATEGORIES.filter((c) => (replies ?? []).some((r) => r.category === c));

  async function use(r: PickerReply, how: "insert" | "copy") {
    const text = fillReply(r.body, context);
    void recordReplyUseAction(r.id).catch(() => {});
    if (how === "insert" && onPick) {
      onPick(text);
      close();
      return;
    }
    const ok = await copyText(text);
    setCopied(ok ? r.id : `fail:${r.id}`);
    if (ok) window.setTimeout(close, 700);
  }

  return (
    <>
      <button type="button" onClick={open} className={cx(buttonClass(variant, size), className)} aria-haspopup="dialog">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {label}
      </button>

      {mounted && createPortal(
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="sheet fixed inset-x-0 top-auto bottom-0 w-full md:inset-0 md:m-auto md:h-fit md:max-w-lg"
      >
        <div className="sheet-panel mx-auto flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl md:max-h-[80dvh] md:rounded-2xl">
          <div className="border-b border-border px-4 pb-3 pt-4 md:px-6 md:pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id={titleId} className="title">Saved replies</h2>
              <button type="button" onClick={close} className={cx(buttonClass("ghost"), "-mr-2 shrink-0")}>
                Close
              </button>
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Search replies"
              aria-label="Search saved replies"
              className="input"
              autoComplete="off"
            />
            {presentCats.length > 1 && (
              <div className="chips -mx-4 mt-3 flex-nowrap overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Category">
                {[{ key: "" as const, label: "All" }, ...presentCats.map((c) => ({ key: c, label: REPLY_CATEGORY_LABEL[c] }))].map((c) => (
                  <button key={c.key || "all"} type="button" aria-pressed={cat === c.key} onClick={() => setCat(c.key)} className="chip shrink-0">
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 md:px-6">
            {error && <p role="alert" className="status is-danger mt-3 whitespace-normal">{error}</p>}
            {!error && replies === null && <p className="meta py-6">Loading…</p>}
            {!error && replies && shown.length === 0 && (
              <p className="meta py-6">
                {replies.length === 0 ? "No saved replies yet." : "Nothing matches."}{" "}
                <Link href="/replies" className="link">Add one</Link>
              </p>
            )}
            <ul className="list">
              {shown.map((r) => {
                const text = fillReply(r.body, context);
                const missing = missingPlaceholders(text);
                const state = copied === r.id ? "ok" : copied === `fail:${r.id}` ? "fail" : null;
                return (
                  <li key={r.id} className="py-3">
                    <p className="font-medium">{r.title}</p>
                    <p className="meta mt-0.5 line-clamp-3 whitespace-pre-line">{text}</p>
                    {missing.length > 0 && (
                      <p className="status is-warn is-small mt-1 whitespace-normal">Fill in: {missing.map((m) => `{${m}}`).join(" ")}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {onPick && (
                        <button type="button" onClick={() => use(r, "insert")} className={buttonClass("secondary", "sm")}>
                          Insert
                        </button>
                      )}
                      <button type="button" onClick={() => use(r, "copy")} className={buttonClass(onPick ? "ghost" : "secondary", "sm")}>
                        <span aria-live="polite">{state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : "Copy"}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-border px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-6 md:py-3">
            <Link href="/replies" className="link-quiet inline-flex min-h-11 items-center md:pointer-fine:min-h-0">
              Manage saved replies →
            </Link>
          </div>
        </div>
      </dialog>,
      document.body,
      )}
    </>
  );
}
