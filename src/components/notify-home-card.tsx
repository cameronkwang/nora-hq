"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currentSubscription, pushEnv } from "./notify-enable";
import { buttonClass } from "./ui";

const KEY = "nhq.notify-card.dismissed";

/**
 * One-time card on Home: "Get a buzz on your phone". Hidden once dismissed (localStorage), when this device
 * already has notifications on, when they're blocked, or when the browser can't do them.
 */
export function NotifyHomeCard() {
  const [show, setShow] = useState<null | "install" | "enable">(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(KEY)) return;
      } catch {
        /* storage blocked: still show it */
      }
      const env = pushEnv();
      if (env === "unsupported") return;
      if (env === "ios-install") return !cancelled && setShow("install");
      if (Notification.permission === "denied") return;
      const sub = Notification.permission === "granted" ? await currentSubscription() : null;
      if (!sub && !cancelled) setShow("enable");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShow(null);
  };

  return (
    <section aria-label="Phone notifications" className="relative rounded-xl border border-border bg-surface p-4 pr-12">
      <p className="font-medium">Get a buzz on your phone</p>
      <p className="mt-1 text-sm text-muted">
        {show === "install"
          ? "Add Nora HQ to your Home Screen (Share → Add to Home Screen), open it from there, then turn on notifications for collab requests, asks and visit reminders."
          : "Turn on notifications for new collab requests, asks for you, drafts to review and visit reminders."}
      </p>
      <div className="mt-3">
        <Link href="/settings/notifications" className={buttonClass("primary", "md")}>{show === "install" ? "Show me how" : "Turn on"}</Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
      >
        <span aria-hidden>×</span>
      </button>
    </section>
  );
}
