"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import type { ShotItem } from "@/lib/schema";
import { addShotAction, removeShotAction, toggleShotAction } from "@/app/(app)/deals/actions";
import { buttonClass, cx } from "./ui";

type Op = { type: "toggle"; id: string; done: boolean } | { type: "add"; item: ShotItem } | { type: "remove"; id: string };

function apply(list: ShotItem[], op: Op): ShotItem[] {
  if (op.type === "toggle") return list.map((s) => (s.id === op.id ? { ...s, done: op.done } : s));
  if (op.type === "add") return [...list, op.item];
  return list.filter((s) => s.id !== op.id);
}

/**
 * The shot list as big tap rows. Ticks show instantly (optimistic) and save in the background;
 * if a save fails the tick springs back and a short message says so.
 * `large` = Visit mode (≥56px rows, bigger type). `editable` shows a remove button per shot.
 */
export function DealShotList({ dealId, shots, large = false, editable = false }: { dealId: string; shots: ShotItem[]; large?: boolean; editable?: boolean }) {
  const [list, change] = useOptimistic(shots, apply);
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const tmp = useRef(0);

  const done = list.filter((s) => s.done).length;

  function toggle(s: ShotItem) {
    const next = !s.done;
    setError("");
    if (next && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(10);
    startTransition(async () => {
      change({ type: "toggle", id: s.id, done: next });
      const r = await toggleShotAction(dealId, s.id, next);
      if (r.error) setError(r.error);
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    setError("");
    startTransition(async () => {
      change({ type: "add", item: { id: `tmp-${++tmp.current}`, text: t, done: false } });
      const r = await addShotAction(dealId, t);
      if (r.error) {
        setError(r.error);
        setText(t);
      }
    });
    input.current?.focus();
  }

  function remove(s: ShotItem) {
    setError("");
    startTransition(async () => {
      change({ type: "remove", id: s.id });
      const r = await removeShotAction(dealId, s.id);
      if (r.error) setError(r.error);
    });
  }

  return (
    <div>
      {list.length > 0 && (
        <p className={cx("num", large ? "font-medium" : "meta", done === list.length && "text-text")} aria-live="polite">
          {done}/{list.length} shot{done === list.length ? ", all done" : ""}
        </p>
      )}
      {list.length === 0 ? (
        <div className="empty">
          <p>No shots yet</p>
          <p>Claude writes one when the deal is created, or add your own below.</p>
        </div>
      ) : (
        <ul className={cx("list g-shots", large && "is-large")}>
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={s.done}
                onClick={() => toggle(s)}
                disabled={s.id.startsWith("tmp-")}
                className="g-shot"
              >
                <span aria-hidden className="box" />
                <span className="t">{s.text}</span>
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={() => remove(s)}
                  disabled={s.id.startsWith("tmp-")}
                  aria-label={`Remove “${s.text}”`}
                  className="g-shot-x"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-3 flex gap-2">
        <label htmlFor={`add-shot-${dealId}`} className="sr-only">Add a shot</label>
        <input
          ref={input}
          id={`add-shot-${dealId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Add a shot…"
          enterKeyHint="done"
          autoComplete="off"
          className="input min-w-0 flex-1"
        />
        <button type="submit" disabled={!text.trim()} className={cx(buttonClass("secondary"), "shrink-0")}>Add</button>
      </form>
      {error && <p role="alert" className="status is-danger is-small mt-2 whitespace-normal">{error}</p>}
    </div>
  );
}
