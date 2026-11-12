"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { KitView, type KitIdentity, type KitStats, type MediaKitSettings } from "./kit-view";
import { CopyButton } from "./copy-button";
import { Badge, buttonClass, cx } from "./ui";
import { DEFAULT_RATE_LINE } from "@/lib/collab-copy";
import type { KitFormState } from "@/app/(app)/kit-settings/actions";

type Action = (s: KitFormState, fd: FormData) => Promise<KitFormState>;

function Toggle({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-11 items-start gap-3 py-1">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium md:text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function IntentButton({ intent, children, variant = "secondary" }: { intent: string; children: string; variant?: "primary" | "secondary" | "danger" }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} className={cx(buttonClass(variant), "flex-1 sm:flex-none")}>
      {mine ? "Saving…" : children}
    </button>
  );
}

export function KitSettingsForm({
  action,
  initial,
  stats,
  identity,
  candidates,
  kitUrl,
}: {
  action: Action;
  initial: MediaKitSettings;
  stats: KitStats;
  identity: KitIdentity;
  candidates: string[];
  kitUrl: string;
}) {
  const [state, formAction] = useActionState(action, {} as KitFormState);
  const [s, setS] = useState<MediaKitSettings>(initial);
  const set = <K extends keyof MediaKitSettings>(k: K, v: MediaKitSettings[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const enabled = state.enabled ?? initial.enabled;

  // Past collabs: ticked suggestions + anything typed in (one per line).
  const [picked, setPicked] = useState<string[]>(initial.pastCollabs.filter((n) => candidates.includes(n)));
  const [extra, setExtra] = useState(initial.pastCollabs.filter((n) => !candidates.includes(n)).join("\n"));
  const [stylesText, setStylesText] = useState(initial.styles.join("\n"));
  const extraList = extra.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
  const preview: MediaKitSettings = {
    ...s,
    pastCollabs: [...new Set([...picked, ...extraList])],
    styles: stylesText.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean),
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
      <form action={formAction} className="flex min-w-0 flex-col gap-5" aria-label="Media kit settings">
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Status</h2>
            {enabled ? <Badge tone="ok">Live</Badge> : <Badge>Not published</Badge>}
          </div>
          {enabled ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <a href="/kit" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all font-medium text-accent hover:underline md:min-h-0">
                {kitUrl}
              </a>
              <CopyButton text={kitUrl} label="Copy link" size="sm" />
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">Only you can see the preview. Publish to make /kit public (it 404s until then).</p>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">About you</h2>
          <div>
            <label className="label" htmlFor="k-headline">Headline</label>
            <input id="k-headline" name="headline" maxLength={140} value={s.headline} onChange={(e) => set("headline", e.target.value)} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="k-bio">Bio</label>
            <textarea id="k-bio" name="bio" maxLength={800} rows={5} value={s.bio} onChange={(e) => set("bio", e.target.value)} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="k-styles">Content style</label>
            <textarea id="k-styles" name="styles" rows={4} value={stylesText} onChange={(e) => setStylesText(e.target.value)} className="input" placeholder={"Restaurant features\nReels & TikToks"} />
            <p className="mt-1 text-xs text-muted">One per line — shown as chips.</p>
          </div>
          <div>
            <label className="label" htmlFor="k-email">Contact email</label>
            <input id="k-email" name="contactEmail" type="email" inputMode="email" autoCapitalize="none" maxLength={200} value={s.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} className="input" placeholder="Optional — for businesses who'd rather email" />
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Rates</h2>
          <Toggle name="showRate" checked={s.showRate} onChange={(v) => set("showRate", v)} label="Show the rate line" hint="On the media kit and the /collab form." />
          <div>
            <label className="label" htmlFor="k-rate">Rate line</label>
            <textarea id="k-rate" name="rateLine" maxLength={300} rows={2} value={s.rateLine} onChange={(e) => set("rateLine", e.target.value)} className="input" />
            {s.rateLine.trim() !== DEFAULT_RATE_LINE && (
              <button type="button" onClick={() => set("rateLine", DEFAULT_RATE_LINE)} className="mt-1 inline-flex min-h-11 items-center text-xs text-accent hover:underline md:min-h-0">
                Reset to “{DEFAULT_RATE_LINE}”
              </button>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">What to show</h2>
          <Toggle name="showCities" checked={s.showCities} onChange={(v) => set("showCities", v)} label="Top audience cities" hint={stats.cities.length ? stats.cities.join(", ") : "Shows once Instagram audience insights sync."} />
          <Toggle name="showPastCollabs" checked={s.showPastCollabs} onChange={(v) => set("showPastCollabs", v)} label="Past collabs" hint="Only the businesses you tick below." />
          {s.showPastCollabs && (
            <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-3">
              {candidates.length > 0 && (
                <fieldset>
                  <legend className="label">Pick who to show</legend>
                  <div className="flex flex-wrap gap-2">
                    {candidates.map((n) => {
                      const on = picked.includes(n);
                      return (
                        <label key={n} className={cx("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm md:min-h-9", on ? "border-accent bg-accent-soft" : "border-border bg-surface")}>
                          <input type="checkbox" name="pastCollabs" value={n} checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, n] : p.filter((x) => x !== n)))} className="size-4" />
                          {n}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <div>
                <label className="label" htmlFor="k-past">Others</label>
                <textarea id="k-past" name="pastCollabsExtra" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} className="input" placeholder="One business per line" />
              </div>
            </div>
          )}
          {/* Keep the picks when the section is collapsed. */}
          {!s.showPastCollabs && (
            <>
              {picked.map((n) => <input key={n} type="hidden" name="pastCollabs" value={n} />)}
              <input type="hidden" name="pastCollabsExtra" value={extra} />
            </>
          )}
        </section>

        <div className="sticky-actions flex flex-col gap-2 rounded-xl border border-border bg-surface/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <>
                <IntentButton intent="save" variant="primary">Save changes</IntentButton>
                <IntentButton intent="unpublish" variant="danger">Unpublish</IntentButton>
              </>
            ) : (
              <>
                <IntentButton intent="publish" variant="primary">Publish</IntentButton>
                <IntentButton intent="save">Save draft</IntentButton>
              </>
            )}
          </div>
          <p role="status" aria-live="polite" className={cx("text-xs", state.error ? "text-danger" : "text-ok", !state.error && !state.message && "sr-only")}>
            {state.error ?? state.message ?? ""}
          </p>
        </div>
      </form>

      <section aria-label="Preview" className="min-w-0 lg:sticky lg:top-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Live preview</p>
        <div className="max-h-none overflow-hidden rounded-2xl border border-border bg-bg px-4 py-8 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <KitView settings={preview} stats={stats} identity={identity} preview />
        </div>
      </section>
    </div>
  );
}
