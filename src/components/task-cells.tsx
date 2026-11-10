"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { editTaskField, type EditableTaskField } from "@/app/(app)/tasks/actions";
import { cx } from "./ui";

/**
 * Inline task editors shared by the table and the board: each saves its own field through a server action
 * and shows a tiny saving / saved / error dot. Uncontrolled on purpose — callers key them by the server value
 * so a refresh with new data remounts them.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useFieldSave(id: string, field: EditableTaskField, refresh = false) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  const save = (value: string, onError?: () => void) =>
    start(async () => {
      setState("saving");
      setError(null);
      const r = await editTaskField(id, field, value, refresh);
      if (r.ok) setState("saved");
      else {
        setState("error");
        setError(r.error);
        onError?.();
      }
    });
  return { state, error, save };
}

export function SaveDot({ state, error }: { state: SaveState; error: string | null }) {
  return (
    <>
      <span
        aria-hidden
        title={state === "error" ? (error ?? "Not saved") : state === "saved" ? "Saved" : undefined}
        className={cx(
          "pointer-events-none absolute right-1 top-1 size-1.5 rounded-full transition-opacity",
          state === "idle" && "opacity-0",
          state === "saving" && "animate-pulse bg-muted",
          state === "saved" && "bg-ok",
          state === "error" && "bg-danger",
        )}
      />
      <span className="sr-only" aria-live="polite">
        {state === "saved" ? "Saved" : state === "error" ? `Not saved: ${error}` : ""}
      </span>
      {state === "error" && error && <span className="mt-0.5 block text-xs text-danger">{error}</span>}
    </>
  );
}

/** Spreadsheet-feel control: a plain field on phones, borderless until hover/focus on desktop. */
export const cellControl = cx(
  "w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-base text-text min-h-11",
  "md:min-h-0 md:border-transparent md:bg-transparent md:px-2 md:py-1.5 md:text-sm md:hover:border-border md:focus:border-accent md:focus:bg-surface",
  "focus:outline-2 focus:outline-accent focus:-outline-offset-1",
);

type Common = { id: string; field: EditableTaskField; label: string; className?: string; refresh?: boolean };

export function TextCell({ id, field, label, value, className, inputClassName }: Common & { value: string; inputClassName?: string }) {
  const { state, error, save } = useFieldSave(id, field);
  const saved = useRef(value);
  return (
    <div className={cx("relative", className)}>
      <input
        aria-label={label}
        defaultValue={value}
        className={cx(cellControl, inputClassName)}
        autoComplete="off"
        enterKeyHint="done"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.value = saved.current;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const el = e.currentTarget;
          const v = el.value.trim();
          if (v === saved.current) return;
          if (!v) {
            el.value = saved.current;
            return;
          }
          const prev = saved.current;
          saved.current = v;
          save(v, () => {
            saved.current = prev;
            el.value = prev;
          });
        }}
      />
      <SaveDot state={state} error={error} />
    </div>
  );
}

export function SelectCell({
  id, field, label, value, options, className, selectClassName, refresh,
}: Common & { value: string; options: Array<{ value: string; label: string }>; selectClassName?: string }) {
  const { state, error, save } = useFieldSave(id, field, refresh);
  const saved = useRef(value);
  return (
    <div className={cx("relative", className)}>
      <select
        aria-label={label}
        defaultValue={value}
        className={cx(cellControl, "cursor-pointer", selectClassName)}
        onChange={(e) => {
          const el = e.currentTarget;
          const prev = saved.current;
          saved.current = el.value;
          save(el.value, () => {
            saved.current = prev;
            el.value = prev;
          });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <SaveDot state={state} error={error} />
    </div>
  );
}

export function DateCell({ id, field, label, value, className, overdue }: Common & { value: string; overdue?: boolean }) {
  const { state, error, save } = useFieldSave(id, field);
  const saved = useRef(value);
  return (
    <div className={cx("relative", className)}>
      <input
        type="date"
        aria-label={label}
        defaultValue={value}
        className={cx(cellControl, overdue && "font-semibold text-danger")}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.currentTarget.value = saved.current;
            e.currentTarget.blur();
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const el = e.currentTarget;
          if (el.value === saved.current) return;
          if (el.value && !/^\d{4}-\d{2}-\d{2}$/.test(el.value)) {
            el.value = saved.current;
            return;
          }
          const prev = saved.current;
          saved.current = el.value;
          save(el.value, () => {
            saved.current = prev;
            el.value = prev;
          });
        }}
      />
      <SaveDot state={state} error={error} />
    </div>
  );
}
