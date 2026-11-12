"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Pulse = { version: string; latestAsk: { id: string; from: string | null; mine: boolean; preview: string } | null };

const INTERVAL_MS = 20_000;

/**
 * Keeps every page fresh without a manual reload: polls /api/pulse every 20s while the tab is visible
 * (and immediately when you come back to it), re-renders the page when anything changed, and shows a
 * small banner when someone else drops a new ask. Typing isn't interrupted: router.refresh() keeps
 * client state and form inputs.
 */
export function LiveRefresh() {
  const router = useRouter();
  const last = useRef<Pulse | null>(null);
  const [toast, setToast] = useState<Pulse["latestAsk"]>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/pulse", { cache: "no-store" });
        if (!res.ok) return;
        const p = (await res.json()) as Pulse;
        const prev = last.current;
        last.current = p;
        if (!prev || prev.version === p.version) return;
        router.refresh();
        if (p.latestAsk && !p.latestAsk.mine && p.latestAsk.id !== prev.latestAsk?.id) setToast(p.latestAsk);
      } catch {
        /* offline — try again next tick */
      }
    };
    const loop = async () => {
      await check();
      if (!stopped) timer = setTimeout(loop, INTERVAL_MS);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };

    void loop();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 12_000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-3 z-50 flex justify-center px-4 md:top-4">
      <div className="flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">New ask from {toast.from}</span>
          <span className="block truncate text-muted">{toast.preview}</span>
        </span>
        <Link href={`/asks/${toast.id}`} onClick={() => setToast(null)} className="inline-flex min-h-11 items-center font-medium text-accent">Open</Link>
        <button onClick={() => setToast(null)} aria-label="Dismiss" className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted">✕</button>
      </div>
    </div>
  );
}
