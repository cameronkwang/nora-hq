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
          <div className="border-b border-border px-4 pb-3 pt-3 md:px-5 md:pt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id={titleId} className="text-base font-semibold">Saved replies</h2>
              <button type="button" onClick={close} className="-mr-2 flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-accent">
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
              <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Category">
                {[{ key: "" as const, label: "All" }, ...presentCats.map((c) => ({ key: c, label: REPLY_CATEGORY_LABEL[c] }))].map((c) => (
                  <button
                    key={c.key || "all"}
                    type="button"
                    aria-pressed={cat === c.key}
                    onClick={() => setCat(c.key)}
                    className={cx(
                      "min-h-11 shrink-0 rounded-full border px-3 text-sm md:min-h-8",
                      cat === c.key ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted hover:text-text",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 md:px-5">
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            {!error && replies === null && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
            {!error && replies && shown.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">
                {replies.length === 0 ? "No saved replies yet." : "Nothing matches."}{" "}
                <Link href="/replies" className="text-accent hover:underline">Add one</Link>
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {shown.map((r) => {
                const text = fillReply(r.body, context);
                const missing = missingPlaceholders(text);
                const state = copied === r.id ? "ok" : copied === `fail:${r.id}` ? "fail" : null;
                return (
                  <li key={r.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-semibold">{r.title}</p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted">{text}</p>
                    {missing.length > 0 && (
                      <p className="mt-1 text-xs text-warn">Fill in: {missing.map((m) => `{${m}}`).join(" ")}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {onPick && (
                        <button type="button" onClick={() => use(r, "insert")} className={buttonClass("primary", "sm")}>
                          Insert
                        </button>
                      )}
                      <button type="button" onClick={() => use(r, "copy")} className={buttonClass(onPick ? "ghost" : "primary", "sm")}>
                        <span aria-live="polite">{state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : "Copy"}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="border-t border-border px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-5">
            <Link href="/replies" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline md:min-h-0">
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
