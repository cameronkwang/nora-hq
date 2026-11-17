"use client";

import { useActionState } from "react";
import { createCalendarFeedAction, type NewFeedState } from "@/app/(app)/settings/notifications/actions";
import { CopyButton } from "./copy-button";
import { SubmitButton } from "./client-form";
import { Status, buttonClass } from "./ui";

/**
 * "Make a calendar link": the private link is shown once, right here, with Apple (webcal://) and Google steps.
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
          if (hasFeed && !window.confirm("Make a new link? The current one stops working, and calendars using it need the new link.")) e.preventDefault();
        }}
      >
        {/* Secondary: "Turn on notifications" is this page's one primary. */}
        <SubmitButton variant="secondary" pendingLabel="Making…">{hasFeed ? "Make a new link" : "Make my calendar link"}</SubmitButton>
      </form>
      {state.error && <p role="alert" className="status is-danger is-small ps-err flex">{state.error}</p>}
      {state.token && (
        <div role="status" className="flex flex-col gap-4 border-y border-border py-4">
          <Status tone="ok" className="whitespace-normal font-medium text-text">Your private calendar link: add it now. It won&apos;t be shown again.</Status>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input id="cal-new-link" readOnly value={https} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 font-mono sm:flex-1" aria-label="Calendar link" />
            <CopyButton targetId="cal-new-link" label="Copy link" />
          </div>
          <div>
            <p className="font-medium">iPhone / Mac (Apple Calendar)</p>
            <p className="mt-1 text-muted">Tap below and confirm <span className="font-medium text-text">Subscribe</span>.</p>
            <a href={webcal} className={`${buttonClass("secondary", "md")} mt-3`}>Add to Apple Calendar</a>
          </div>
          <div>
            <p className="font-medium">Google Calendar</p>
            <ol className="ps-steps-list mt-2 text-muted">
              <li><span aria-hidden className="n">1</span><span>Copy the link above.</span></li>
              <li><span aria-hidden className="n">2</span><span>On a computer, open calendar.google.com → <span className="font-medium text-text">Other calendars +</span> → <span className="font-medium text-text">From URL</span>.</span></li>
              <li><span aria-hidden className="n">3</span><span>Paste it and tap <span className="font-medium text-text">Add calendar</span>. (Google refreshes it every few hours.)</span></li>
            </ol>
          </div>
          <p className="meta">Anyone with this link can see your calendar, so don&apos;t share it. You can turn it off below at any time.</p>
        </div>
      )}
    </div>
  );
}
