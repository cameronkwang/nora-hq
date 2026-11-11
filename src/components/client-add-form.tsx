import Link from "next/link";
import { createClientAction } from "@/app/(app)/clients/actions";
import { SERVICES, SERVICE_LABELS, type Service } from "@/lib/ops-onboarding";
import { ActionForm, SubmitButton } from "./client-form";

const HINTS: Record<Service, string> = {
  social: "Posts, stories, TikToks, creator outreach",
  google: "Reply to Google reviews",
  collab: "Nora creates collab content",
};

const DEFAULT_ON: Service[] = ["social", "google"];

/**
 * "Add business" — a short form. Creates the business with a monthly plan matching the services
 * and a Getting started checklist, then lands on its page. Server component (ActionForm is the client part).
 */
export function ClientAddForm() {
  return (
    <ActionForm action={createClientAction} className="flex flex-col gap-3" ariaLabel="Add business">
      <div>
        <label className="label" htmlFor="new-name">Business name</label>
        <input id="new-name" name="name" required className="input" placeholder="e.g. Poke Bros" autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="new-location">City <span className="font-normal">(optional)</span></label>
        <input id="new-location" name="location" className="input" placeholder="e.g. Richmond" autoComplete="off" />
      </div>

      <fieldset className="min-w-0">
        <legend className="label">What we&apos;ll do for them</legend>
        <div className="flex flex-col gap-2">
          {SERVICES.map((s) => (
            <label
              key={s}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
            >
              <input type="checkbox" name="services" value={s} defaultChecked={DEFAULT_ON.includes(s)} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{SERVICE_LABELS[s]}</span>
                <span className="block text-xs text-muted">{HINTS[s]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <details className="group rounded-lg border border-border">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
          Handles &amp; website <span className="ml-1 font-normal text-muted">(optional)</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <label className="label" htmlFor="new-ig">Instagram</label>
              <input id="new-ig" name="instagramHandle" className="input" placeholder="@handle" autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </div>
            <div>
              <label className="label" htmlFor="new-tt">TikTok</label>
              <input id="new-tt" name="tiktokHandle" className="input" placeholder="@handle" autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="new-web">Website</label>
            <input id="new-web" name="website" type="text" inputMode="url" className="input" placeholder="pokebros.com" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </div>
        </div>
      </details>

      <p className="text-xs text-muted">We&apos;ll set up a monthly plan and a short getting-started checklist for you.</p>
      <SubmitButton pendingLabel="Adding…">Add business</SubmitButton>
      <p className="text-xs text-muted">
        Not a client yet? <Link href="/leads" className="text-accent hover:underline">Prospects live in Leads</Link>.
      </p>
    </ActionForm>
  );
}
