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
      // 24px under the chips (their 16px margin collapses into this one), where the first draft starts on the other tabs.
      <div className="mt-6 flex flex-col gap-6">
        {(sentCount > 0 || (group && skippedHere > 0)) && (
          <div>
            {sentCount > 0 && (
              <p role="status" className="notice">
                <span className="status is-ok whitespace-normal text-text">{sentCount} marked sent. Each creator moved to Contacted with a follow-up in 5 days.</span>
              </p>
            )}
            {group && skippedHere > 0 && (
              <div className="notice items-center">
                <p className="min-w-0 flex-1 basis-56">
                  <span className="font-medium">You skipped {skippedHere} for {group.sendFrom ?? group.business}.</span>{" "}
                  <span className="text-muted">They stay approved until you send them.</span>
                </p>
                <button type="button" onClick={() => setSkipped([])} className={cx(buttonClass("secondary"), "w-full sm:w-auto")}>
                  Go through them again
                </button>
              </div>
            )}
          </div>
        )}
        {live.length === 0 ? (
          <div className="empty border-t border-border">
            <p>Nothing left to send</p>
            <p>Approved outreach shows up here as soon as you approve it.</p>
          </div>
        ) : (
          (group ? others : live).length > 0 && (
            <div>
              <p className="eyebrow border-b border-border pb-2">{group ? "Next account" : "Pick the account you're signed in to"}</p>
              <ul className="list">
                {(group ? others : live).map((g) => (
                  <li key={g.key}>
                    {/* One row per account: who to send as, the business, and how many are waiting (the count comes last). */}
                    <button type="button" onClick={() => start(g.key)} className="send-pick">
                      <span className="min-w-0">
                        <span className="row-title block break-words">Send as {g.sendFrom ?? g.business}</span>
                        <span className="meta block">
                          {g.sendFrom ? `${g.business}${g.sendFromKind && g.sendFromKind !== "other" ? ` · ${SEND_FROM_LABEL[g.sendFromKind]}` : ""}` : "No sender saved yet: use the business's own account"}
                        </span>
                      </span>
                      <span className="count shrink-0 text-base">{g.items.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
        <p>
          <Link href={backHref} className="link-quiet inline-flex min-h-11 items-center">← Back to the list</Link>
        </p>
      </div>
    );
  }

  /* ── One message at a time ── */
  const mailtoHref = current.mailto
    ? `mailto:${encodeURIComponent(current.mailto.to)}?subject=${encodeURIComponent(current.mailto.subject)}&body=${encodeURIComponent(current.body)}`
    : null;

  return (
    <div className="mt-6 max-w-2xl max-md:pb-40">
      {/* A section: ink rule, who you send as (serif), one quiet action; then one line of facts. */}
      <header className="sec-head">
        <h2 className="title break-words">Send as {group.sendFrom ?? group.business}</h2>
        <button type="button" onClick={() => setActiveKey(null)} className={cx(buttonClass("ghost", "sm"), "-my-1 -mr-1.5 shrink-0")}>
          {live.length > 1 ? "Switch" : "Close"}
        </button>
      </header>
      <p className="sec-note" aria-live="polite">
        {group.sendFrom ? `${group.business} · ` : ""}
        {group.sendFrom && group.sendFromKind && group.sendFromKind !== "other" ? `${SEND_FROM_LABEL[group.sendFromKind]} · ` : ""}
        not Nora · <b className="num">{queue.length}</b> left{skippedHere > 0 ? ` · ${skippedHere} skipped` : ""}
      </p>

      {!group.sendFrom && (
        <p className="notice block">
          <span className="status is-warn is-run">No sender is saved for {group.business}.</span> Send these from the business&apos;s own account, not Nora&apos;s.{" "}
          <Link href={`/clients/${group.clientId}/settings#outreach-profile`} className="link">Set it</Link>
        </p>
      )}
      {group.offer && <p className="notice block break-words">Offer: {group.offer}</p>}

      {/* The message: who it goes to, then the words. Content of the section above, so no second ink rule. */}
      <article className="mt-6">
        <header>
          <p className="break-words font-semibold">
            {current.creatorName}
            {current.to && <span className="font-normal text-muted"> · {current.to}</span>}
          </p>
          <p className="meta">
            {current.channelLabel}
            {current.followers ? ` · ${current.followers}` : ""} · <span className={cx(current.check.warn && "status is-warn is-run font-medium")}>{current.check.label}</span> ·{" "}
            {current.posted ? <span className="status is-danger is-run font-medium">already posted about {group.business}</span> : "no prior posts"}
          </p>
          {current.mailto && <p className="mt-1 break-words text-sm"><span className="text-muted">Subject:</span> {current.mailto.subject || "(no subject)"}</p>}
        </header>
        <div className="mt-3 flex flex-col gap-3">
          {current.blocked && (
            <p role="alert" className="status is-danger flex whitespace-normal">
              <span>{current.blocked} Skip it.</span>
            </p>
          )}
          {current.posted && (
            <p className="status is-danger flex whitespace-normal">
              <span>
                They already posted about {group.business}. Only send this if you meant to.{" "}
                {current.posted.url && <a href={current.posted.url} target="_blank" rel="noopener noreferrer nofollow" className="link">See the post ↗</a>}
              </span>
            </p>
          )}
          {current.mismatch && (
            <p className="status is-warn flex whitespace-normal">
              <span>{current.mismatch}</span>
            </p>
          )}
          <p className="whitespace-pre-wrap break-words border-t border-border pt-3">{current.body}</p>
          <p className="meta">
            <Link href={`/review?draft=${current.id}`} className="link">Edit this message</Link>
            {current.profile && (
              <>
                {" · "}
                <a href={current.profile.href} target="_blank" rel="noreferrer" className="link">{current.profile.label} ↗</a>
              </>
            )}
          </p>
        </div>
      </article>

      {error && (
        <p role="alert" className="status is-danger mt-3 flex whitespace-normal">
          <span>{error}</span>
        </p>
      )}

      {/* The four buttons: a solid bar above the tab bar on phones (two rows, thumbs-sized); one row of natural widths on desktop. */}
      <div className="queue-bar fixed inset-x-0 bottom-[var(--tabbar-h)] z-20 px-4 py-2 md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-xl flex-col gap-2 md:mx-0 md:max-w-none md:flex-row md:flex-wrap">
          <div className="grid grid-cols-2 gap-2 md:flex">
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
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 md:flex">
            <button type="button" onClick={() => setSkipped((s) => [...s, current.id])} disabled={busy} className={buttonClass("secondary")}>
              Skip
            </button>
            <button type="button" onClick={() => void markSent(current)} disabled={busy || !!current.blocked} className={cx(buttonClass("primary"), "md:px-6")}>
              {busy ? "Saving…" : "Sent ✓"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
