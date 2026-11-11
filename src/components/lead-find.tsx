"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { findLeadsAction, type LeadFormState } from "@/app/(app)/leads/actions";
import { buttonClass, cx } from "./ui";

const WHAT_FOR = [
  { value: "google", label: "Google reviews", hint: "Lots of reviews, few replies" },
  { value: "social", label: "Social", hint: "Quiet or weak Instagram" },
  { value: "collab", label: "Collab", hint: "Great for a feature by Nora" },
] as const;

/**
 * The one big action on /leads: four quick answers, then Claude does the research.
 * Bottom sheet on phones, centered dialog on desktop (native <dialog>: focus trap, Esc closes).
 */
export function FindLeads({ defaultArea = "", autoOpen = false }: { defaultArea?: string; autoOpen?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(findLeadsAction, {} as LeadFormState);
  const [shownAt, setShownAt] = useState<number | undefined>(undefined);

  const show = () => {
    setShownAt(state.at);
    dialog.current?.showModal();
    setOpen(true);
  };
  const close = () => dialog.current?.close();

  useEffect(() => {
    if (autoOpen) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  // Reset the form after a successful send so the next search starts fresh.
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state.at, state.ok]);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  const fresh = state.at !== undefined && state.at !== shownAt;
  const done = fresh && state.ok;

  return (
    <>
      <button type="button" onClick={show} className={buttonClass("primary")} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
        Find leads
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="find-leads-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="sheet fixed inset-x-0 top-auto bottom-0 w-full md:inset-0 md:m-auto md:h-fit md:max-w-md"
      >
        <div className="sheet-panel mx-auto max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-xl md:rounded-2xl md:p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 id="find-leads-title" className="text-base font-semibold">Find leads</h2>
              <p className="text-sm text-muted">Tell Claude where to look. It researches and adds them here — you just pick who to pitch.</p>
            </div>
            <button type="button" onClick={close} className="-mr-2 -mt-1 flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-accent">
              {done ? "Done" : "Cancel"}
            </button>
          </div>

          {done ? (
            <div role="status" className="space-y-3 py-2">
              <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{state.message}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={close} className={buttonClass("primary")}>Got it</button>
                {state.askId && (
                  <Link href={`/asks/${state.askId}`} className={buttonClass("secondary")}>See the request</Link>
                )}
              </div>
            </div>
          ) : (
            <form ref={form} action={action} className="space-y-4">
              <div>
                <label className="label" htmlFor="fl-area">Where</label>
                <input id="fl-area" name="area" required minLength={2} defaultValue={defaultArea} placeholder="City or neighborhood, e.g. Richmond, VA" className="input" autoComplete="off" />
              </div>
              <div>
                <label className="label" htmlFor="fl-type">Type of place <span className="font-normal">(optional)</span></label>
                <input id="fl-type" name="placeType" placeholder="e.g. coffee shops, Korean BBQ, bakeries" className="input" autoComplete="off" />
              </div>
              <fieldset>
                <legend className="label">What for</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {WHAT_FOR.map((o) => (
                    <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                      <input type="checkbox" name="opportunities" value={o.value} defaultChecked className="mt-0.5 shrink-0" />
                      <span className="text-sm leading-tight">
                        <span className="block font-medium">{o.label}</span>
                        <span className="block text-xs text-muted">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label className="label" htmlFor="fl-count">How many</label>
                <select id="fl-count" name="count" defaultValue="10" className="input">
                  {[5, 10, 15, 20, 30].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              {fresh && state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
              <Submit />
              <p className="text-xs text-muted">Claude only uses public info and public business contacts.</p>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "w-full")}>
      {pending ? "Sending…" : "Ask Claude to find them"}
    </button>
  );
}
