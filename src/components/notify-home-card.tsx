"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currentSubscription, pushEnv } from "./notify-enable";
import { buttonClass, cx } from "./ui";

const KEY = "nhq.notify-card.dismissed";

/**
 * One-time note on Home: "Get a buzz on your phone". Hidden once dismissed (localStorage), when this device
 * already has notifications on, when they're blocked, or when the browser can't do them.
 * One row between hairlines (.notice): the words, then "Turn on" and a quiet dismiss.
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
    <section aria-label="Phone notifications" className="notice">
      <p className="min-w-0 flex-1 basis-64">
        <span className="font-medium">Get a buzz on your phone.</span>{" "}
        <span className="text-muted">
          {show === "install"
            ? "Add Nora HQ to your Home Screen (Share → Add to Home Screen), open it from there, then turn on notifications for collab requests, asks and visit reminders."
            : "Turn on notifications for new collab requests, asks for you, drafts to review and visit reminders."}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Link href="/settings/notifications" className={buttonClass("secondary", "sm")}>{show === "install" ? "Show me how" : "Turn on"}</Link>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className={cx(buttonClass("ghost", "sm"), "px-2 text-base")}>
          <span aria-hidden>×</span>
        </button>
      </div>
    </section>
  );
}
