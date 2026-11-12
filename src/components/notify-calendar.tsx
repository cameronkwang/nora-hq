"use client";

import { useActionState } from "react";
import { createCalendarFeedAction, type NewFeedState } from "@/app/(app)/settings/notifications/actions";
import { CopyButton } from "./copy-button";
import { SubmitButton } from "./client-form";
import { buttonClass } from "./ui";

/**
 * "Make a calendar link" — the private link is shown once, right here, with Apple (webcal://) and Google steps.
 * Making a new one turns the previous link off.
 */
export function NotifyCalendarLink({ base, hasFeed }: { base: string; hasFeed: boolean }) {
  const [state, action] = useActionState<NewFeedState, FormData>(createCalendarFeedAction, {});
  const https = state.token ? `${base}/api/calendar/${state.token}.ics` : "";
  const webcal = https.replace(/^https?:\/\//, "webcal://");
  return (
    <div className="flex flex-col gap-3">
      <form
        action={action}
        onSubmit={(e) => {
          if (hasFeed && !window.confirm("Make a new link? The current one stops working — calendars using it need the new link.")) e.preventDefault();
        }}
      >
        <SubmitButton variant={hasFeed ? "secondary" : "primary"} pendingLabel="Making…">{hasFeed ? "Make a new link" : "Make my calendar link"}</SubmitButton>
      </form>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.token && (
        <div role="status" className="flex flex-col gap-3 rounded-lg border border-ok/30 bg-ok-soft p-3">
          <p className="text-sm font-medium text-ok">Your private calendar link — add it now. It won&apos;t be shown again.</p>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input id="cal-new-link" readOnly value={https} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 font-mono text-xs" aria-label="Calendar link" />
            <CopyButton targetId="cal-new-link" label="Copy link" variant="primary" />
          </div>
          <div className="text-sm">
            <p className="font-medium">iPhone / Mac (Apple Calendar)</p>
            <p className="mt-1 text-muted">Tap below and confirm <span className="font-medium text-text">Subscribe</span>.</p>
            <a href={webcal} className={`${buttonClass("secondary", "md")} mt-2`}>Add to Apple Calendar</a>
          </div>
          <div className="text-sm">
            <p className="font-medium">Google Calendar</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
              <li>Copy the link above.</li>
              <li>On a computer, open calendar.google.com → <span className="font-medium text-text">Other calendars +</span> → <span className="font-medium text-text">From URL</span>.</li>
              <li>Paste it and tap <span className="font-medium text-text">Add calendar</span>. (Google refreshes it every few hours.)</li>
            </ol>
          </div>
          <p className="text-xs text-muted">Anyone with this link can see your calendar — don&apos;t share it. You can turn it off below at any time.</p>
        </div>
      )}
    </div>
  );
}
