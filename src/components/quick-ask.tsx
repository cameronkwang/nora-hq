"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { quickAskAction } from "./capture-actions";
import { ROUTE_LABEL, routesFor, type AskRoute } from "./ask-route";
import { checkFile, uploadFiles } from "./upload-picker";
import { buttonClass, cx } from "./ui";

type Chip = AskRoute | "adhoc";

/** Compact chip labels for the composer. */
const LABEL = (r: Chip, other: string) => (r === "adhoc" ? "Ad hoc task" : r === "idea" ? "Idea" : r === "cameron" || r === "nora" ? other : ROUTE_LABEL[r]);

const MAX_HEIGHT = 240;

/**
 * The composer at the very top of Home: type (or dictate) a line, optionally pick who it's for,
 * optionally add a photo, Send. Stays on Home and confirms inline. "Ad hoc task" puts a task straight
 * on the other person's list instead of making an ask.
 */
export function QuickAsk({ me, directUpload }: { me: "cameron" | "nora" | null; directUpload: boolean }) {
  const base = routesFor(me); // auto · claude · <other person> · idea · fyi
  const otherKey = base[2] as AskRoute;
  const otherName = otherKey === "nora" ? "Nora" : "Cameron";
  const chips: Chip[] = ["auto", "claude", otherKey, "adhoc", "idea"];

  const [text, setText] = useState("");
  const [route, setRoute] = useState<Chip>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ message: string; href: string } | null>(null);
  const [busy, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const fileId = useId();

  // Single line that grows as you type.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(null), 6000);
    return () => clearTimeout(t);
  }, [sent]);

  const canSend = !busy && (text.trim().length > 0 || files.length > 0);

  function send(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    setError(null);
    const bad = files.map(checkFile).find(Boolean);
    if (bad) {
      setError(bad);
      return;
    }
    start(async () => {
      try {
        const attachments = files.length ? await uploadFiles(files, directUpload) : [];
        const res = await quickAskAction({ body: text, route, attachments });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setText("");
        setFiles([]);
        setRoute("auto");
        setSent({ message: res.message, href: res.href });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Desktop: Enter sends, Shift+Enter is a new line. Phones keep Enter as a new line.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (e.metaKey || e.ctrlKey || window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      send();
    }
  }

  return (
    <form onSubmit={send} className="rounded-xl border border-border bg-surface p-2 shadow-sm focus-within:border-accent/60">
      <label htmlFor="quick-ask" className="sr-only">Ask anything</label>
      <textarea
        id="quick-ask"
        ref={area}
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (sent) setSent(null);
        }}
        onKeyDown={onKeyDown}
        readOnly={busy}
        enterKeyHint="send"
        placeholder="Ask anything — Claude or Cameron will pick it up"
        className="block w-full resize-none bg-transparent px-2 py-2 text-base leading-6 text-text outline-none placeholder:text-muted/80"
        style={{ minHeight: "2.5rem" }}
      />

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-2 pb-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="inline-flex max-w-48 items-center gap-1 rounded-full bg-surface-2 py-0.5 pl-2.5 pr-0.5 text-xs text-muted">
              <span className="truncate">{f.name || "Photo"}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="tap-target flex size-6 items-center justify-center rounded-full hover:bg-surface"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pt-1">
        <div role="radiogroup" aria-label="Who's it for?" className="flex min-w-0 basis-full flex-wrap gap-1.5 sm:basis-0 sm:flex-1">
          {chips.map((r) => {
            const on = r === route;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => setRoute(r)}
                className={cx(
                  "inline-flex min-h-8 items-center rounded-full border px-2.5 text-xs font-medium transition pointer-coarse:min-h-11 pointer-coarse:px-3 pointer-coarse:text-sm",
                  on ? "border-accent bg-accent-soft text-accent" : "border-transparent bg-surface-2 text-muted hover:text-text",
                )}
              >
                {LABEL(r, otherName)}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <input
            id={fileId}
            type="file"
            accept="image/*,video/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              setFiles([...files, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <label
            htmlFor={fileId}
            title="Add a photo or video"
            className={cx(
              "inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11",
              busy && "pointer-events-none opacity-50",
            )}
          >
            <span className="sr-only">Add a photo or video</span>
            <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </label>
          <button type="submit" disabled={!canSend} className={cx(buttonClass("primary"), "min-w-20")}>
            {busy ? (files.length ? "Uploading…" : "Sending…") : "Send"}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="px-2">
        {sent && (
          <p role="status" className="flex flex-wrap items-center gap-x-2 pt-2 text-sm text-ok">
            <span>{sent.message}</span>
            <Link href={sent.href} className="inline-flex min-h-11 items-center text-muted underline-offset-2 hover:underline md:min-h-0">
              View
            </Link>
          </p>
        )}
        {error && (
          <p role="alert" className="pt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
