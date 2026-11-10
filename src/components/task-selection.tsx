"use client";

import { createContext, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { bulkTasksAction, type BulkOp } from "@/app/(app)/tasks/actions";
import { ASSIGNEES } from "@/lib/schema";
import { buttonClass, cx, humanize } from "./ui";

/**
 * Multi-select for task lists + the bulk action bar.
 * <TaskSelection ids={visibleIds}> wraps a list or table; rows render <TaskSelectBox id>.
 * In "toggle" mode (list view) checkboxes only appear after tapping "Select", so the everyday list stays calm.
 */

type Ctx = {
  ids: string[];
  selected: Set<string>;
  selecting: boolean;
  setSelecting: (on: boolean) => void;
  toggle: (id: string, on?: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Ctx | null>(null);
export const useTaskSelection = () => useContext(SelectionContext);

export function TaskSelection({ ids, alwaysOn = false, children }: { ids: string[]; alwaysOn?: boolean; children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectingRaw, setSelecting] = useState(false);
  const selecting = alwaysOn || selectingRaw || selected.size > 0;
  const idKey = ids.join(",");

  // Drop ids that left the page (deleted, filtered out, moved by a bulk action).
  useEffect(() => {
    const live = new Set(idKey ? idKey.split(",") : []);
    setSelected((s) => {
      const next = new Set([...s].filter((id) => live.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [idKey]);

  const ctx = useMemo<Ctx>(
    () => ({
      ids,
      selected,
      selecting,
      setSelecting: (on) => {
        setSelecting(on);
        if (!on) setSelected(new Set());
      },
      toggle: (id, on) =>
        setSelected((s) => {
          const next = new Set(s);
          if (on ?? !next.has(id)) next.add(id);
          else next.delete(id);
          return next;
        }),
      setAll: (on) => setSelected(on ? new Set(ids) : new Set()),
      clear: () => {
        setSelected(new Set());
        setSelecting(false);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idKey, selected, selecting],
  );

  return (
    <SelectionContext.Provider value={ctx}>
      <div>
        {/* Before the content so the desktop bar can stick to the top while the list scrolls under it. */}
        <BulkBar />
        {children}
        {/* Keeps the last rows reachable above the floating bar on phones. */}
        {selected.size > 0 && <div aria-hidden className="h-36 md:hidden" />}
      </div>
    </SelectionContext.Provider>
  );
}

const boxCls = "size-5 shrink-0 cursor-pointer rounded border-border";

/** Row checkbox. Renders nothing outside a <TaskSelection> or while list selection is off. */
export function TaskSelectBox({ id, title, className }: { id: string; title: string; className?: string }) {
  const ctx = useTaskSelection();
  if (!ctx || !ctx.selecting) return null;
  return (
    <label className={cx("tap-target flex shrink-0 items-center justify-center", className)}>
      <input type="checkbox" className={boxCls} checked={ctx.selected.has(id)} onChange={(e) => ctx.toggle(id, e.currentTarget.checked)} aria-label={`Select “${title}”`} />
    </label>
  );
}

/** Select-all checkbox (with a visible label unless `bare`). */
export function TaskSelectAll({ bare = false, className }: { bare?: boolean; className?: string }) {
  const ctx = useTaskSelection();
  if (!ctx || !ctx.selecting || ctx.ids.length === 0) return null;
  const all = ctx.selected.size > 0 && ctx.selected.size === ctx.ids.length;
  const some = ctx.selected.size > 0 && !all;
  return (
    <label className={cx("tap-target inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        className={boxCls}
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = some;
        }}
        onChange={(e) => ctx.setAll(e.currentTarget.checked)}
        aria-label={bare ? `Select all ${ctx.ids.length} tasks` : undefined}
      />
      {!bare && <span>Select all {ctx.ids.length}</span>}
    </label>
  );
}

/** "Select" / "Done selecting" switch for the list view. */
export function TaskSelectToggle() {
  const ctx = useTaskSelection();
  if (!ctx || ctx.ids.length === 0) return null;
  return (
    <button type="button" onClick={() => ctx.setSelecting(!ctx.selecting)} className={cx(buttonClass("ghost", "sm"), "text-muted")}>
      {ctx.selecting ? "Cancel" : "Select"}
    </button>
  );
}

function BulkBar() {
  const ctx = useTaskSelection()!;
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const n = ctx.selected.size;

  useEffect(() => {
    if (n === 0) setConfirmDelete(false);
  }, [n]);
  useEffect(() => {
    if (!msg || msg.tone === "danger") return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  const run = (op: BulkOp, value?: string, done?: string) =>
    start(async () => {
      setMsg(null);
      const r = await bulkTasksAction([...ctx.selected], op, value);
      if (r.ok) {
        ctx.clear();
        setMsg({ tone: "ok", text: done ?? "Done." });
      } else setMsg({ tone: "danger", text: r.error });
      setConfirmDelete(false);
    });

  if (n === 0)
    return msg ? (
      <p role="status" className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+0.75rem)] z-30 mx-auto max-w-md rounded-lg bg-text px-3 py-2 text-center text-sm text-bg shadow-lg md:bottom-6">
        {msg.text}
      </p>
    ) : null;

  const plural = (k: number) => `${k} task${k === 1 ? "" : "s"}`;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cx(
        // Phone: floats above the tab bar. Desktop: sticks to the top of the content while scrolling.
        "fixed inset-x-3 bottom-[calc(var(--tabbar-h)+0.5rem)] z-30 rounded-xl border border-border bg-surface p-2 shadow-lg",
        "md:sticky md:inset-x-auto md:top-2 md:bottom-auto md:mb-3",
      )}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex items-center justify-between gap-2 px-1 md:justify-start">
          <p className="text-sm font-semibold" aria-live="polite">{n} selected</p>
          <button type="button" onClick={ctx.clear} className={cx(buttonClass("ghost", "sm"), "text-muted")}>Clear</button>
        </div>
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <span className="text-sm">Delete {plural(n)}? This can’t be undone.</span>
            <button type="button" disabled={pending} onClick={() => run("delete", undefined, `Deleted ${plural(n)}.`)} className={cx(buttonClass("primary", "sm"), "bg-danger! text-surface!")}>
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} className={buttonClass("secondary", "sm")}>Keep</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center md:ml-auto">
            <button type="button" disabled={pending} onClick={() => run("done", undefined, `Marked ${plural(n)} done.`)} className={buttonClass("primary", "sm")}>
              Mark done
            </button>
            <select
              aria-label="Assign selected tasks to"
              disabled={pending}
              value=""
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v) run("assign", v, v === "unassigned" ? `Unassigned ${plural(n)}.` : `Assigned ${plural(n)} to ${humanize(v)}.`);
              }}
              className="input w-full py-1! font-medium sm:w-auto"
            >
              <option value="">Assign to…</option>
              {ASSIGNEES.map((a) => (
                <option key={a} value={a}>{humanize(a)}</option>
              ))}
            </select>
            <button type="button" disabled={pending} onClick={() => run("next_month", undefined, `Moved ${plural(n)} to next month.`)} className={buttonClass("secondary", "sm")}>
              Next month
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirmDelete(true)} className={buttonClass("danger", "sm")}>
              Delete
            </button>
          </div>
        )}
      </div>
      {msg?.tone === "danger" && (
        <p role="alert" className="mt-2 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">{msg.text}</p>
      )}
    </div>
  );
}
