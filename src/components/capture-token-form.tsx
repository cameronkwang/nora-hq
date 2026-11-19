"use client";

import { useActionState } from "react";
import { createCaptureTokenAction, type NewTokenState } from "@/app/(app)/settings/capture/actions";
import { CopyButton } from "./copy-button";
import { SubmitButton } from "./client-form";
import { Status } from "./ui";

/** "New key" form. The key is shown once, right here, with a copy button: it can't be shown again. */
export function CaptureTokenForm({ defaultLabel }: { defaultLabel: string }) {
  const [state, action] = useActionState<NewTokenState, FormData>(createCaptureTokenAction, {});
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="cap-label" className="label">Name this key</label>
          <input id="cap-label" name="label" defaultValue={defaultLabel} maxLength={60} className="input" autoComplete="off" />
        </div>
        {/* One primary per screen: once a key is shown, copying it is the thing to do. */}
        <SubmitButton variant="secondary" pendingLabel="Making…">Make a key</SubmitButton>
      </form>
      {state.error && <p role="alert" className="status is-danger is-small ps-err flex">{state.error}</p>}
      {state.token && (
        <div role="status" className="border-y border-border py-4">
          <Status tone="ok" className="whitespace-normal font-medium text-text">Key for “{state.label}”: copy it now. It won’t be shown again.</Status>
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="cap-new-token"
              readOnly
              value={state.token}
              onFocus={(e) => e.currentTarget.select()}
              className="input min-w-0 font-mono sm:flex-1"
              aria-label="Your new key"
            />
            <CopyButton targetId="cap-new-token" label="Copy key" variant="secondary" />
          </div>
          <p className="meta mt-2">Paste it into the Shortcut’s Authorization header as <code className="font-mono">Bearer</code> + a space + the key (step 6 below).</p>
        </div>
      )}
    </div>
  );
}
