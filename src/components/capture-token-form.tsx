"use client";

import { useActionState } from "react";
import { createCaptureTokenAction, type NewTokenState } from "@/app/(app)/settings/capture/actions";
import { CopyButton } from "./copy-button";
import { SubmitButton } from "./client-form";

/** "New key" form. The key is shown once, right here, with a copy button — it can't be shown again. */
export function CaptureTokenForm({ defaultLabel }: { defaultLabel: string }) {
  const [state, action] = useActionState<NewTokenState, FormData>(createCaptureTokenAction, {});
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="cap-label" className="label">Name this key</label>
          <input id="cap-label" name="label" defaultValue={defaultLabel} maxLength={60} className="input" autoComplete="off" />
        </div>
        <SubmitButton pendingLabel="Making…">Make a key</SubmitButton>
      </form>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.token && (
        <div role="status" className="rounded-lg border border-ok/30 bg-ok-soft p-3">
          <p className="text-sm font-medium text-ok">Key for “{state.label}” — copy it now. It won’t be shown again.</p>
          <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="cap-new-token"
              readOnly
              value={state.token}
              onFocus={(e) => e.currentTarget.select()}
              className="input min-w-0 flex-1 font-mono text-xs"
              aria-label="Your new key"
            />
            <CopyButton targetId="cap-new-token" label="Copy key" variant="primary" />
          </div>
          <p className="mt-2 text-xs text-muted">Paste it into the Shortcut’s Authorization header as <code>Bearer</code> + a space + the key (step 6 below).</p>
        </div>
      )}
    </div>
  );
}
