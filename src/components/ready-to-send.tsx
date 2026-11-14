"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOutreachSentQuickAction } from "@/app/(app)/review/actions";
import type { SendGroup, SendItem } from "@/app/(app)/review/send-queries";
import { SEND_FROM_LABEL } from "@/lib/outreach-profile";
import { copyText } from "./copy-button";
import { buttonClass, cx } from "./ui";

/**
 * Send mode for approved creator outreach ("Ready to send" on /review). Messages are grouped by the account they go
 * out from (the business's outreach profile, never Nora's). Pick an account, then one message at a time:
 * Copy text → Open DM (or email app) → send it there → Sent ✓ (the same "mark sent" path as the queue) or Skip.
 * Built for one hand on a phone: the four buttons sit in a bar above the tab bar. Nothing is sent by Nora HQ.
 */
export function ReadyToSend({ groups, backHref }: { groups: SendGroup[]; backHref: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeKey, setActiveKey] = useState<string | null>(groups.length === 1 ? groups[0].key : null);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [skipped, setSkipped] = useState<string[]>([]);
  /** The message whose text was copied (or whose DM / email was opened): "Sent ✓" on anything else asks first. */
  const [handled, setHandled] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(
    () => groups.map((g) => ({ ...g, items: g.items.filter((i) => !sent.has(i.id)) })).filter((g) => g.items.length > 0),
    [groups, sent],
  );
  const group = live.find((g) => g.key === activeKey) ?? null;
  const queue = group ? group.items.filter((i) => !skipped.includes(i.id)) : [];
  const current = queue[0] ?? null;
  const skippedHere = group ? group.items.length - queue.length : 0;
  const currentId = current?.id ?? null;

  useEffect(() => {
    setCopied(false);
    setError(null);
  }, [currentId]);

  function start(key: string) {
    setActiveKey(key);
    setSkipped([]);
  }

  async function copy(item: SendItem) {
    const ok = await copyText(item.body);
    setCopied(ok);
    if (ok) setHandled(item.id);
    else setError("Couldn't copy. Press and hold the text to copy it.");
  }

  async function markSent(item: SendItem) {
    if (busy || item.blocked) return;
    if (handled !== item.id && !window.confirm("You haven't copied or opened this one yet. Mark it as sent anyway?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await markOutreachSentQuickAction({ id: item.id });
      if (r.ok) {
        setSent((s) => new Set(s).add(item.id));
        window.scrollTo({ top: 0 });
      } else setError(r.message);
    } catch {
      setError("Couldn't reach Nora HQ. Check your connection and try again.");
    } finally {
      setBusy(false);
      startTransition(() => router.refresh());
    }
  }

  const sentCount = sent.size;

  /* ── Pick an account (or: this account is finished) ── */
  if (!group || !current) {
    const others = live.filter((g) => g.key !== group?.key);
    return (
      <div className="flex flex-col gap-4">
        {sentCount > 0 && (
          <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
            {sentCount} marked sent. Each creator moved to Contacted with a follow-up in 5 days.
          </p>
        )}
        {group && skippedHere > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-medium">You skipped {skippedHere} for {group.sendFrom ?? group.business}.</p>
            <p className="mt-1 text-sm text-muted">They stay approved until you send them.</p>
            <button type="button" onClick={() => setSkipped([])} className={cx(buttonClass("primary"), "mt-3 w-full sm:w-auto")}>
              Go through them again
            </button>
          </div>
        )}
        {live.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium">Nothing left to send</p>
            <p className="mt-1 text-sm text-muted">Approved outreach shows up here as soon as you approve it.</p>
          </div>
        ) : (
          (group ? others : live).length > 0 && (
            <div>
              <p className="label">{group ? "Next account" : "Pick the account you're signed in to"}</p>
              <ul className="flex flex-col gap-2">
                {(group ? others : live).map((g) => (
                  <li key={g.key}>
                    <button
                      type="button"
                      onClick={() => start(g.key)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left hover:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="block break-words text-base font-semibold">Send as {g.sendFrom ?? g.business}</span>
                        <span className="block text-sm text-muted">
                          {g.sendFrom ? `${g.business}${g.sendFromKind && g.sendFromKind !== "other" ? ` · ${SEND_FROM_LABEL[g.sendFromKind]}` : ""}` : "No sender saved yet: use the business's own account"}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-sm font-semibold text-accent-fg tabular-nums">{g.items.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
        <p>
          <Link href={backHref} className="text-sm text-accent hover:underline">← Back to the list</Link>
        </p>
      </div>
    );
  }

  /* ── One message at a time ── */
  const mailtoHref = current.mailto
    ? `mailto:${encodeURIComponent(current.mailto.to)}?subject=${encodeURIComponent(current.mailto.subject)}&body=${encodeURIComponent(current.body)}`
    : null;

  return (
    <div className="max-md:pb-40">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{group.business}</p>
          <h2 className="break-words text-lg font-semibold">Send as {group.sendFrom ?? group.business}</h2>
          <p className="text-sm text-muted" aria-live="polite">
            {group.sendFrom && group.sendFromKind && group.sendFromKind !== "other" ? `${SEND_FROM_LABEL[group.sendFromKind]} · ` : ""}
            not Nora · {queue.length} left{skippedHere > 0 ? ` · ${skippedHere} skipped` : ""}
          </p>
        </div>
        <button type="button" onClick={() => setActiveKey(null)} className={cx(buttonClass("ghost", "sm"), "shrink-0")}>
          {live.length > 1 ? "Switch" : "Close"}
        </button>
      </div>

      {!group.sendFrom && (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          No sender is saved for {group.business}. Send these from the business&apos;s own account, not Nora&apos;s.{" "}
          <Link href={`/clients/${group.clientId}/settings#outreach-profile`} className="font-semibold underline">Set it</Link>
        </p>
      )}
      {group.offer && <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">Offer: {group.offer}</p>}

      <article className="rounded-xl border border-border bg-surface">
        <header className="flex flex-col gap-1 border-b border-border px-4 py-3">
          <p className="break-words text-base font-semibold">
            {current.creatorName}
            {current.to && <span className="font-normal text-muted"> · {current.to}</span>}
          </p>
          <p className="text-sm text-muted">
            {current.channelLabel}
            {current.followers ? ` · ${current.followers}` : ""} · <span className={cx(current.check.warn && "font-medium text-warn")}>{current.check.label}</span> ·{" "}
            {current.posted ? <span className="font-medium text-danger">already posted about {group.business}</span> : "no prior posts"}
          </p>
          {current.mailto && <p className="break-words text-sm"><span className="text-muted">Subject:</span> {current.mailto.subject || "(no subject)"}</p>}
        </header>
        <div className="flex flex-col gap-3 p-4">
          {current.blocked && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{current.blocked} Skip it.</p>}
          {current.posted && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              They already posted about {group.business}. Only send this if you meant to.{" "}
              {current.posted.url && <a href={current.posted.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold underline">See the post ↗</a>}
            </p>
          )}
          {current.mismatch && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{current.mismatch}</p>}
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{current.body}</p>
          <p className="text-xs text-muted">
            <Link href={`/review?draft=${current.id}`} className="text-accent hover:underline">Edit this message</Link>
            {current.profile && (
              <>
                {" · "}
                <a href={current.profile.href} target="_blank" rel="noreferrer" className="text-accent hover:underline">{current.profile.label} ↗</a>
              </>
            )}
          </p>
        </div>
      </article>

      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-20 border-t border-border bg-surface/95 px-4 py-2 backdrop-blur md:static md:mt-4 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-xl flex-col gap-2 md:mx-0">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copy(current)} className={buttonClass("secondary")}>
              <span aria-live="polite">{copied ? "Copied ✓" : "Copy text"}</span>
            </button>
            {current.open ? (
              <a
                href={current.open.href}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  // Copy on the way out too, so the text is ready to paste when the app opens.
                  void copyText(current.body).then((ok) => setCopied(ok));
                  setHandled(current.id);
                }}
                className={buttonClass("secondary")}
              >
                {current.open.label} ↗
              </a>
            ) : mailtoHref ? (
              <a href={mailtoHref} onClick={() => setHandled(current.id)} className={buttonClass("secondary")}>
                Open email
              </a>
            ) : (
              <span className={cx(buttonClass("secondary"), "pointer-events-none opacity-50")}>No handle saved</span>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <button type="button" onClick={() => setSkipped((s) => [...s, current.id])} disabled={busy} className={buttonClass("secondary")}>
              Skip
            </button>
            <button type="button" onClick={() => void markSent(current)} disabled={busy || !!current.blocked} className={buttonClass("primary")}>
              {busy ? "Saving…" : "Sent ✓"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
