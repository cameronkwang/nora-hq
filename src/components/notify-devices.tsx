"use client";

import { useEffect, useState, useTransition } from "react";
import type { NotifyTopic } from "@/lib/schema";
import { removeDeviceAction, setTopicsAction } from "@/app/(app)/settings/notifications/actions";
import { ConfirmButton } from "./client-form";
import { NOTIFY_TOPIC_INFO } from "./notify-topics";
import { currentSubscription, endpointKey } from "./notify-enable";
import { cx } from "./ui";

export type DeviceRow = { id: string; endpointKey: string; label: string; topics: NotifyTopic[]; added: string; lastSent: string | null };

/** One device: what it gets (toggles save as you tap) and a remove button. */
function Device({ d, mine }: { d: DeviceRow; mine: boolean }) {
  const [topics, setTopics] = useState<NotifyTopic[]>(d.topics);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(t: NotifyTopic, on: boolean) {
    const prev = topics;
    const next = on ? [...new Set([...topics, t])] : topics.filter((x) => x !== t);
    setTopics(next);
    setError(null);
    start(async () => {
      const r = await setTopicsAction(d.id, next);
      if (!r.ok) {
        setTopics(prev);
        setError(r.error ?? "Couldn't save.");
      }
    });
  }

  return (
    <li className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {d.label}
            {mine && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">This device</span>}
          </p>
          <p className="text-xs text-muted">Added {d.added}{d.lastSent ? ` · last notified ${d.lastSent}` : ""}</p>
        </div>
        <form action={removeDeviceAction}>
          <input type="hidden" name="id" value={d.id} />
          <ConfirmButton confirm={`Stop notifications on ${d.label}?`} variant="ghost" size="sm">Remove</ConfirmButton>
        </form>
      </div>
      <fieldset className="mt-2" aria-label={`What ${d.label} gets`}>
        <ul className="flex flex-col">
          {NOTIFY_TOPIC_INFO.map((t) => {
            const id = `t-${d.id}-${t.topic}`;
            const on = topics.includes(t.topic);
            return (
              <li key={t.topic}>
                <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-surface-2">
                  <input
                    id={id}
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(t.topic, e.currentTarget.checked)}
                    className="size-5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-muted">{t.hint}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p role="status" aria-live="polite" className={cx("mt-1 text-xs", error ? "text-danger" : "text-muted")}>
        {error ?? (pending ? "Saving…" : "")}
      </p>
    </li>
  );
}

export function NotifyDevices({ devices }: { devices: DeviceRow[] }) {
  const [mine, setMine] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await currentSubscription();
      const key = sub ? await endpointKey(sub.endpoint) : null;
      if (!cancelled) setMine(key);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // This device first.
  const sorted = [...devices].sort((a, b) => Number(b.endpointKey === mine) - Number(a.endpointKey === mine));
  return (
    <ul className="divide-y divide-border">
      {sorted.map((d) => <Device key={d.id} d={d} mine={d.endpointKey === mine} />)}
    </ul>
  );
}
