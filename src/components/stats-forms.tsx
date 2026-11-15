"use client";

import { useActionState, useState, useTransition } from "react";
import { logNumbersAction, syncStatsAction, tagPostAction, type ActionState } from "@/app/(app)/stats/actions";
import { Button, cx } from "./ui";

function Note({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role="status" className={cx("status is-small whitespace-normal", state.error ? "is-danger" : "is-ok")}>
      {state.error ?? state.ok}
    </p>
  );
}

/** The 20-second path: followers (+ views) per platform, saved for today. Works before any API is set up. */
export function StatsManualForm({ show }: { show: { instagram: boolean; tiktok: boolean } }) {
  const [state, action, pending] = useActionState(logNumbersAction, null);
  const rows = ([
    ["instagram", "Instagram", "Views, last 30 days"],
    ["tiktok", "TikTok", "Video views, last 28 days"],
  ] as const).filter(([p]) => show[p]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-6 sm:grid-cols-2 sm:gap-x-12">
        {rows.map(([p, label, viewsLabel]) => (
          <fieldset key={p} className="min-w-0">
            <legend className={cx("status mb-2 font-medium", p === "instagram" ? "is-ig" : "is-tt")}>
              {label}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="label" htmlFor={`${p}_followers`}>Followers</label>
                <input id={`${p}_followers`} name={`${p}_followers`} inputMode="decimal" autoComplete="off" placeholder="12,400" className="input tabular-nums" />
              </div>
              <div className="min-w-0">
                <label className="label" htmlFor={`${p}_views`}>{viewsLabel}</label>
                <input id={`${p}_views`} name={`${p}_views`} inputMode="decimal" autoComplete="off" placeholder="optional" className="input tabular-nums" />
              </div>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save today's numbers"}</Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function StatsSyncButton() {
  const [state, action, pending] = useActionState(syncStatsAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <Note state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Syncing…" : "Sync now"}</Button>
    </form>
  );
}

/** Links a post to the business it was a collab for. Saves on change. */
export function StatsTagSelect({ mediaId, value, clients }: { mediaId: string; value: string | null; clients: Array<{ id: string; name: string }> }) {
  const [current, setCurrent] = useState(value ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="min-w-0">
      <label className="sr-only" htmlFor={`tag-${mediaId}`}>Collab for business</label>
      <select
        id={`tag-${mediaId}`}
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = current;
          setCurrent(next);
          setError(null);
          start(async () => {
            const r = await tagPostAction(mediaId, next);
            if (r?.error) {
              setCurrent(prev);
              setError(r.error);
            }
          });
        }}
        className="input h-8 text-sm max-md:h-11 pointer-coarse:h-11"
      >
        <option value="">Not a collab</option>
        {clients.map((c) => <option key={c.id} value={c.id}>Collab: {c.name}</option>)}
      </select>
      {error && <p className="status is-danger is-small mt-1 whitespace-normal">{error}</p>}
    </div>
  );
}
