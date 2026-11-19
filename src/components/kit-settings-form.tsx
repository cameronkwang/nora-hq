"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { KitView, type KitIdentity, type KitStats, type MediaKitSettings } from "./kit-view";
import { CopyButton } from "./copy-button";
import { Section, Status, Tag, buttonClass, cx } from "./ui";
import { DEFAULT_RATE_LINE } from "@/lib/collab-copy";
import type { KitFormState } from "@/app/(app)/kit-settings/actions";

type Action = (s: KitFormState, fd: FormData) => Promise<KitFormState>;

/** A show/hide choice: the ink square, its words and one muted line. Saved with the form, so a checkbox, not a switch. */
function Toggle({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="g-opt">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="check" />
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

function IntentButton({ intent, children, variant = "secondary" }: { intent: string; children: string; variant?: "primary" | "secondary" | "danger" }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} className={cx(buttonClass(variant), "max-sm:flex-1")}>
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
    <div className="grid gap-10 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[1200px]:items-start min-[1200px]:gap-x-16 max-md:gap-8">
      <form action={formAction} className="min-w-0" aria-label="Media kit settings">
        <Section className="!mt-0" title="Status" actions={enabled ? <Status tone="ok" small>Live</Status> : <Tag bare>Not published</Tag>}>
          {enabled ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <a href="/kit" target="_blank" rel="noopener noreferrer" className="link inline-flex min-h-11 items-center break-all md:min-h-0">
                {kitUrl}
              </a>
              <CopyButton text={kitUrl} label="Copy link" size="sm" />
            </div>
          ) : (
            <p className="text-muted">Only you can see the preview. Publish to make /kit public (it 404s until then).</p>
          )}
        </Section>

        <Section title="About you">
          <div className="grid gap-5">
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
              <p className="hint">One per line.</p>
            </div>
            <div>
              <label className="label" htmlFor="k-email">Contact email</label>
              <input id="k-email" name="contactEmail" type="email" inputMode="email" autoCapitalize="none" maxLength={200} value={s.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} className="input" placeholder="Optional, for businesses who'd rather email" />
            </div>
          </div>
        </Section>

        <Section title="Rates">
          <Toggle name="showRate" checked={s.showRate} onChange={(v) => set("showRate", v)} label="Show the rate line" hint="On the media kit and the /collab form." />
          <div className="mt-3">
            <label className="label" htmlFor="k-rate">Rate line</label>
            <textarea id="k-rate" name="rateLine" maxLength={300} rows={2} value={s.rateLine} onChange={(e) => set("rateLine", e.target.value)} className="input !min-h-0" />
            {s.rateLine.trim() !== DEFAULT_RATE_LINE && (
              <button type="button" onClick={() => set("rateLine", DEFAULT_RATE_LINE)} className="link-quiet tap-target mt-2 whitespace-normal text-left">
                Reset to “{DEFAULT_RATE_LINE}”
              </button>
            )}
          </div>
        </Section>

        <Section title="What to show">
          <Toggle name="showCities" checked={s.showCities} onChange={(v) => set("showCities", v)} label="Top audience cities" hint={stats.cities.length ? stats.cities.join(", ") : "Shows once Instagram audience insights sync."} />
          <Toggle name="showPastCollabs" checked={s.showPastCollabs} onChange={(v) => set("showPastCollabs", v)} label="Past collabs" hint="Only the businesses you tick below." />
          {s.showPastCollabs && (
            <div className="mt-2 grid gap-4 border-t border-border pt-4">
              {candidates.length > 0 && (
                <fieldset>
                  <legend className="label">Pick who to show</legend>
                  <div className="g-opts is-wrap">
                    {candidates.map((n) => {
                      const on = picked.includes(n);
                      return (
                        <label key={n} className="g-opt">
                          <input type="checkbox" name="pastCollabs" value={n} checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, n] : p.filter((x) => x !== n)))} className="check" />
                          <span>{n}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <div>
                <label className="label" htmlFor="k-past">Others</label>
                <textarea id="k-past" name="pastCollabsExtra" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} className="input !min-h-0" placeholder="One business per line" />
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
        </Section>

        <div className="sticky-actions action-bar mt-10 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex gap-2 max-sm:w-full">
            {enabled ? (
              <>
                <IntentButton intent="save">Save changes</IntentButton>
                <IntentButton intent="unpublish" variant="danger">Unpublish</IntentButton>
              </>
            ) : (
              <>
                <IntentButton intent="publish">Publish</IntentButton>
                <IntentButton intent="save">Save draft</IntentButton>
              </>
            )}
          </div>
          <p role="status" aria-live="polite" className={cx(!state.error && !state.message && "sr-only")}>
            {state.error ? <Status tone="danger" small>{state.error}</Status> : state.message ? <Status tone="ok" small>{state.message}</Status> : ""}
          </p>
        </div>
      </form>

      <section aria-label="Preview" className="min-w-0 min-[1200px]:sticky min-[1200px]:top-6">
        <p className="eyebrow mb-3">Live preview</p>
        <div className="g-frame">
          <KitView settings={preview} stats={stats} identity={identity} preview />
        </div>
      </section>
    </div>
  );
}
