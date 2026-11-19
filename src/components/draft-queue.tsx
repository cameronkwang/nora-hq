"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { approveDraftQuickAction, bulkApproveReplyAction, rejectDraftQuickAction, type QuickOutcome } from "@/app/(app)/review/actions";
import { BULK_APPROVE_KINDS } from "./draft-checks";
import { buttonClass, cx } from "./ui";

/**
 * Wraps the "Needs review" list to make approving fast:
 *  - Phone (<md): focus mode — one card at a time, "3 of 9", sticky Approve / Edit / Send back (rendered by
 *    DraftEditor through this context), slides to the next card after each action. No page reloads: the actions
 *    return an outcome and we router.refresh() in the background.
 *  - Desktop: the full list, plus keyboard shortcuts j/k (next/prev), a (approve — press twice), e (edit), s (send back).
 *  - Bulk approve for Google review replies only.
 */

export type QueueItem = { id: string; kind: string; title: string; node: ReactNode };

export type EditorHandle = {
  /** Current text (with any unsaved edits) and whether the editor would allow approving it. */
  snapshot(): { body: string; blocked: boolean; postKey?: string };
  focusEdit(): void;
  openSendBack(): void;
};

type QueueApi = {
  register(id: string, h: EditorHandle): () => void;
  isCurrent(id: string): boolean;
  position: { index: number; total: number };
  busyId: string | null;
  approve(id: string): Promise<void>;
  reject(id: string, note: string): Promise<void>;
  prev(): void;
  next(): void;
  /** Phone list/focus toggle state. */
  focusMode: boolean;
};

const QueueContext = createContext<QueueApi | null>(null);
export const useDraftQueue = () => useContext(QueueContext);

type Toast = { tone: "ok" | "warn" | "danger"; msg: string; openId?: string };

const SLIDE_CSS = `@keyframes dq-slide{from{transform:translateX(28px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion: no-preference) and (max-width: 767.98px){.dq-current{animation:dq-slide 220ms ease-out}}`;

function isTyping(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function DraftQueue({ items, googleConnected }: { items: QueueItem[]; googleConnected: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const handles = useRef(new Map<string, EditorHandle>());
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [currentId, setCurrentId] = useState<string | null>(items[0]?.id ?? null);
  const lastIndex = useRef(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(true);
  /** Desktop: outline the current card only once someone starts using the keyboard. */
  const [kbdUsed, setKbdUsed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const wrapRefs = useRef(new Map<string, HTMLDivElement>());

  const visible = useMemo(() => items.filter((i) => !done.has(i.id)), [items, done]);
  // Keep the same card if it's still there; otherwise whatever now sits where it was (i.e. the next one).
  let index = visible.findIndex((i) => i.id === currentId);
  if (index === -1) index = Math.min(lastIndex.current, Math.max(0, visible.length - 1));
  const current = visible[index] ?? null;
  useEffect(() => {
    lastIndex.current = index;
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [index, current, currentId]);

  // Forget "done" ids once the server list no longer has them, and selections that vanished.
  useEffect(() => {
    const ids = new Set(items.map((i) => i.id));
    setDone((d) => (([...d].some((id) => !ids.has(id))) ? new Set([...d].filter((id) => ids.has(id))) : d));
    setSelected((s) => (([...s].some((id) => !ids.has(id))) ? new Set([...s].filter((id) => ids.has(id))) : s));
  }, [items]);

  useEffect(() => {
    if (!toast || toast.openId) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  const markDone = useCallback((id: string) => {
    setDone((d) => new Set(d).add(id));
    setSelected((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);

  const scrollTo = useCallback((id: string | undefined) => {
    if (!id) return;
    const el = wrapRefs.current.get(id);
    if (!el) return;
    const phone = window.matchMedia("(max-width: 767.98px)").matches;
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (!phone) el.focus({ preventScroll: true });
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (!visible.length) return;
      const n = Math.min(visible.length - 1, Math.max(0, index + delta));
      setCurrentId(visible[n].id);
      setArmed(null);
      scrollTo(visible[n].id);
    },
    [visible, index, scrollTo],
  );

  const showOutcome = useCallback((id: string, r: QuickOutcome) => {
    setToast({
      tone: !r.ok ? "danger" : r.manual ? "warn" : "ok",
      msg: r.message,
      openId: r.ok && r.manual ? id : undefined,
    });
  }, []);

  const approve = useCallback(
    async (id: string) => {
      const h = handles.current.get(id);
      if (!h || busyId) return;
      const snap = h.snapshot();
      if (snap.blocked) {
        setToast({ tone: "danger", msg: "Fix the problem on this draft before approving it." });
        return;
      }
      setBusyId(id);
      setArmed(null);
      try {
        const r = await approveDraftQuickAction({ id, body: snap.body, postKey: snap.postKey });
        // Leaves the queue if it was approved, sent or failed (failed shows under the Failed tab).
        if (r.status) markDone(id);
        showOutcome(id, r);
        if (r.status && window.matchMedia("(max-width: 767.98px)").matches) window.scrollTo({ top: 0 });
      } catch {
        setToast({ tone: "danger", msg: "Couldn't reach Nora HQ. Check your connection and try again." });
      } finally {
        setBusyId(null);
        refresh();
      }
    },
    [busyId, markDone, refresh, showOutcome],
  );

  const reject = useCallback(
    async (id: string, note: string) => {
      if (busyId) return;
      setBusyId(id);
      try {
        const r = await rejectDraftQuickAction({ id, note });
        if (r.ok) markDone(id);
        showOutcome(id, r);
        if (r.ok && window.matchMedia("(max-width: 767.98px)").matches) window.scrollTo({ top: 0 });
      } catch {
        setToast({ tone: "danger", msg: "Couldn't reach Nora HQ. Check your connection and try again." });
      } finally {
        setBusyId(null);
        refresh();
      }
    },
    [busyId, markDone, refresh, showOutcome],
  );

  const register = useCallback((id: string, h: EditorHandle) => {
    handles.current.set(id, h);
    return () => {
      if (handles.current.get(id) === h) handles.current.delete(id);
    };
  }, []);

  // Desktop keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isTyping(e.target) && !document.querySelector("dialog[open]")) {
        (e.target as HTMLElement).blur(); // leave the text box so the shortcuts work again
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const k = e.key.toLowerCase();
      if (k === "escape") return setArmed(null);
      if (!current) return;
      if (["j", "k", "e", "s", "a"].includes(k)) setKbdUsed(true);
      if (k === "j") {
        e.preventDefault();
        move(1);
      } else if (k === "k") {
        e.preventDefault();
        move(-1);
      } else if (k === "e") {
        e.preventDefault();
        setArmed(null);
        handles.current.get(current.id)?.focusEdit();
      } else if (k === "s") {
        e.preventDefault();
        setArmed(null);
        handles.current.get(current.id)?.openSendBack();
      } else if (k === "a") {
        e.preventDefault();
        if (armed === current.id) void approve(current.id);
        else setArmed(current.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, armed, move, approve]);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const api = useMemo<QueueApi>(
    () => ({
      register,
      isCurrent: (id) => current?.id === id,
      position: { index, total: visible.length },
      busyId,
      approve,
      reject,
      prev: () => move(-1),
      next: () => move(1),
      focusMode,
    }),
    [register, current, index, visible.length, busyId, approve, reject, move, focusMode],
  );

  const bulkCandidates = visible.filter((i) => (BULK_APPROVE_KINDS as readonly string[]).includes(i.kind));

  if (visible.length === 0) {
    return (
      <div className="empty border-t border-border">
        <p>All caught up</p>
        <p>Nothing else is waiting for review.</p>
        {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  return (
    <QueueContext.Provider value={api}>
      <style>{SLIDE_CSS}</style>

      {/* Phone: progress + prev/next + list toggle */}
      <div className="mb-2 flex items-center justify-between gap-2 md:hidden">
        {focusMode ? (
          <div className="-ml-2.5 flex items-center gap-0.5">
            <button type="button" onClick={() => move(-1)} disabled={index === 0} aria-label="Previous draft" className={cx(buttonClass("ghost"), "w-11 px-0")}>
              <Arrow dir="left" />
            </button>
            <span className="num min-w-16 text-center font-semibold" aria-live="polite">
              {index + 1} of {visible.length}
            </span>
            <button type="button" onClick={() => move(1)} disabled={index >= visible.length - 1} aria-label="Next draft" className={cx(buttonClass("ghost"), "w-11 px-0")}>
              <Arrow dir="right" />
            </button>
          </div>
        ) : (
          <span className="meta">{visible.length} waiting</span>
        )}
        <button type="button" onClick={() => setFocusMode((f) => !f)} className={cx(buttonClass("ghost"), "-mr-2.5")}>
          {focusMode ? "Show all" : "One at a time"}
        </button>
      </div>

      {/* Desktop: shortcut hint */}
      <p className="meta mb-4 hidden flex-wrap items-center gap-x-4 gap-y-1 md:flex" aria-live="polite">
        {armed && current?.id === armed ? (
          <span className="font-semibold text-text">Press A again to approve “{current.title}” · Esc to cancel</span>
        ) : (
          <>
            <span>Shortcuts:</span>
            <span><Kbd>J</Kbd>/<Kbd>K</Kbd> next/prev</span>
            <span><Kbd>A</Kbd> approve (press twice)</span>
            <span><Kbd>E</Kbd> edit</span>
            <span><Kbd>S</Kbd> send back</span>
            <span><Kbd>Esc</Kbd> leave the text box</span>
          </>
        )}
      </p>

      {bulkCandidates.length >= 2 && (
        <BulkBar
          candidates={bulkCandidates}
          selected={selected}
          setSelected={setSelected}
          googleConnected={googleConnected}
          handles={handles}
          onItemDone={markDone}
          onFinished={refresh}
        />
      )}

      <div className={cx("draft-list", focusMode && "max-md:pb-24")}>
        {visible.map((item) => {
          const isCur = current?.id === item.id;
          const bulkable = bulkCandidates.length >= 2 && (BULK_APPROVE_KINDS as readonly string[]).includes(item.kind);
          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) wrapRefs.current.set(item.id, el);
                else wrapRefs.current.delete(item.id);
              }}
              tabIndex={-1}
              onFocusCapture={() => {
                if (!isCur) setCurrentId(item.id);
              }}
              onPointerDown={() => {
                if (!isCur) setCurrentId(item.id);
              }}
              className={cx(
                // Focused from the keyboard shortcuts only; the mark for it is .draft-current, not the page-wide focus ring.
                "scroll-mt-20 outline-none!",
                focusMode && !isCur && "max-md:hidden",
                focusMode && isCur && "dq-current",
                isCur && kbdUsed && "draft-current",
                busyId === item.id && "pointer-events-none opacity-60",
              )}
            >
              {bulkable && (
                <label className="meta mb-2 flex min-h-11 w-fit cursor-pointer items-center gap-2 md:min-h-0">
                  <input
                    type="checkbox"
                    className="check"
                    checked={selected.has(item.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(item.id);
                        else n.delete(item.id);
                        return n;
                      })
                    }
                  />
                  Select for bulk approve
                </label>
              )}
              {item.node}
            </div>
          );
        })}
      </div>

      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </QueueContext.Provider>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="!size-[18px]">
      <path d={dir === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
    </svg>
  );
}

/** A floating note after an action: the one place (with sheets and menus) that takes a shadow. Colour is in the dot. */
function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "pop fixed inset-x-4 z-30 flex items-start justify-between gap-3 px-4 py-3 text-left",
        "bottom-[calc(var(--tabbar-h)+5.5rem)] md:inset-x-auto md:right-6 md:bottom-6 md:max-w-md",
      )}
    >
      <span className={cx("status whitespace-normal text-text", toast.tone === "danger" ? "is-danger" : toast.tone === "warn" ? "is-warn" : "is-ok")}>
        <span>
          {toast.msg}
          {toast.openId && (
            <>
              {" "}
              <Link href={`/review?draft=${toast.openId}`} className="link">Open it to copy &amp; send</Link>
            </>
          )}
        </span>
      </span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="tap-target -mr-1 shrink-0 text-muted hover:text-text">×</button>
    </div>
  );
}

type BulkResult = { id: string; title: string; outcome: QuickOutcome };

function BulkBar({
  candidates,
  selected,
  setSelected,
  googleConnected,
  handles,
  onItemDone,
  onFinished,
}: {
  candidates: QueueItem[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  googleConnected: boolean;
  handles: React.RefObject<Map<string, EditorHandle>>;
  onItemDone: (id: string) => void;
  onFinished: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const chosen = candidates.filter((c) => selected.has(c.id));
  const n = chosen.length;
  const allOn = n === candidates.length;
  const [queued, setQueued] = useState<QueueItem[]>([]);
  const finishedIds = useRef<string[]>([]);

  function openConfirm() {
    setResults(null);
    setProgress(0);
    setQueued(chosen);
    dialog.current?.showModal();
  }

  async function run() {
    setRunning(true);
    setResults([]);
    const out: BulkResult[] = [];
    for (let i = 0; i < queued.length; i++) {
      const item = queued[i];
      setProgress(i + 1);
      const snap = handles.current?.get(item.id)?.snapshot();
      let outcome: QuickOutcome;
      if (snap?.blocked) outcome = { ok: false, message: "Skipped. Fix the problem on this reply first (too long?)." };
      else {
        try {
          outcome = await bulkApproveReplyAction({ id: item.id, body: snap?.body });
        } catch {
          outcome = { ok: false, message: "Couldn't reach Nora HQ." };
        }
      }
      // Hide approved cards only once the sheet is closed: hiding them now would drop the candidate count below 2
      // and unmount this bar (and its results sheet) mid-run.
      if (outcome.status) finishedIds.current.push(item.id);
      out.push({ id: item.id, title: item.title, outcome });
      setResults([...out]);
    }
    setRunning(false);
  }

  /** Sheet closed (Close / Esc / backdrop): now hide the approved cards and refresh the queue. */
  function flush() {
    const ids = finishedIds.current;
    if (!ids.length) return;
    finishedIds.current = [];
    for (const id of ids) onItemDone(id);
    onFinished();
  }

  const posted = results?.filter((r) => r.outcome.ok && r.outcome.status === "sent").length ?? 0;
  const manual = results?.filter((r) => r.outcome.ok && r.outcome.manual).length ?? 0;
  const failed = results?.filter((r) => !r.outcome.ok).length ?? 0;

  return (
    <>
      {/* One row between hairlines. Outlined: the one filled button is on the card you are on (and the sheet has its own). */}
      <div className="notice mb-6 items-center py-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 md:min-h-9">
          <input type="checkbox" className="check" checked={allOn} onChange={(e) => setSelected(new Set(e.target.checked ? candidates.map((c) => c.id) : []))} />
          Select all {candidates.length} review replies
        </label>
        <button type="button" disabled={n === 0} onClick={openConfirm} className={cx(buttonClass("secondary"), "w-full sm:w-auto")}>
          {n === 0 ? "Approve replies" : `Approve ${n} ${n === 1 ? "reply" : "replies"}`}
        </button>
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="bulk-title"
        onCancel={(e) => {
          if (running) e.preventDefault();
        }}
        onClose={flush}
        className="sheet fixed inset-x-0 top-auto bottom-0 w-full md:inset-0 md:m-auto md:h-fit md:max-w-md"
      >
        <div className="sheet-panel mx-auto max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-xl md:rounded-2xl md:p-6">
          <h2 id="bulk-title" className="title">
            {results && !running ? "Done" : `Approve ${queued.length} review ${queued.length === 1 ? "reply" : "replies"}?`}
          </h2>
          {!results && (
            <div className="mt-2 space-y-3">
              {googleConnected ? (
                <p className="status is-warn flex whitespace-normal">
                  <span>
                    Google is connected, so each reply is <strong className="font-semibold">posted publicly on Google right away</strong>, exactly as written on this page.
                  </span>
                </p>
              ) : (
                <p>Google isn&apos;t connected, so they&apos;ll be marked approved. Copy each one, post it from Google Maps, then mark it sent.</p>
              )}
              <p className="meta">Edits you made on the page are included. Replies with a problem are skipped. Outreach, pitches and reports are never bulk-approved.</p>
              <ul className="list is-ruled max-h-40 overflow-y-auto text-sm">
                {queued.map((q) => <li key={q.id} className="py-1.5">{q.title}</li>)}
              </ul>
            </div>
          )}
          {results && (
            <div className="mt-2 space-y-3">
              {running ? (
                <p aria-live="polite">Approving {progress} of {queued.length}…</p>
              ) : (
                <p aria-live="polite">
                  {[posted && `${posted} posted to Google`, manual && `${manual} approved to post by hand`, failed && `${failed} not approved`].filter(Boolean).join(" · ") || "Nothing changed."}
                </p>
              )}
              <ul className="list is-ruled max-h-64 overflow-y-auto">
                {results.map((r) => (
                  <li key={r.id} className="py-2">
                    <span className={cx("status flex whitespace-normal text-text", !r.outcome.ok ? "is-danger" : r.outcome.manual ? "is-warn" : "is-ok")}>
                      <span className="font-medium">{r.outcome.ok ? "✓" : "✕"} {r.title}</span>
                    </span>
                    <span className="meta block pl-[15px]">{r.outcome.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {!results ? (
              <>
                <button type="button" onClick={run} className={cx(buttonClass("primary"), "grow sm:grow-0")}>
                  {googleConnected ? `Approve & post ${queued.length}` : `Approve ${queued.length}`}
                </button>
                <button type="button" onClick={() => dialog.current?.close()} className={buttonClass("secondary")}>Cancel</button>
              </>
            ) : (
              <button type="button" disabled={running} onClick={() => dialog.current?.close()} className={cx(buttonClass("primary"), "grow sm:grow-0")}>
                {running ? "Working…" : "Close"}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
