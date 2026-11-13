"use client";

import { useState } from "react";
import { onboardNewClientAction } from "@/app/(app)/clients/new/actions";
import { PARSED_LABEL, parseBusinessInput, parsedText } from "@/lib/onboard-parse";
import {
  DEFAULT_SERVICES,
  SERVICES,
  SERVICE_HINTS,
  SERVICE_LABELS,
  STARTING_PLAN_NOTE,
  normalizeServices,
  planFor,
  type Service,
} from "@/lib/onboard-services";
import { ActionForm, SubmitButton } from "./client-form";
import { OutreachAreasField } from "./onboard-areas";
import { PlatformTag, cx } from "./ui";

const isFacebookUrl = (u: string) => /^(https?:\/\/)?((www|m|web)\.)?(facebook|fb)\.com\//i.test(u.trim());

export type OnboardPrefill = {
  leadId?: string | null;
  name?: string | null;
  location?: string | null;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
  website?: string | null;
  googleMapsUrl?: string | null;
  /** Current service names, or legacy lead opportunities ("social" → Instagram + TikTok). */
  services?: readonly string[];
  outreachAreas?: string | null;
};

export type PlanSource = { id: string; name: string; items: number };

/**
 * New client — one screen, one required field. "Business name or link" also takes a pasted
 * Instagram / TikTok / Google Maps / website link (or @handle); then it asks for the name separately.
 * The server parses the same field again, so the form works before JS loads.
 */
export function OnboardForm({ prefill = {}, planSources = [] }: { prefill?: OnboardPrefill; planSources?: PlanSource[] }) {
  const [q, setQ] = useState(prefill.name ?? "");
  const [copyFrom, setCopyFrom] = useState("");
  const parsed = parseBusinessInput(q);
  const isLink = parsed.kind !== "name";
  const initial = normalizeServices(prefill.services ?? []);
  const [picked, setPicked] = useState<Service[]>(initial.length ? initial : [...DEFAULT_SERVICES]);
  const toggle = (s: Service, on: boolean) => setPicked((cur) => normalizeServices(on ? [...cur, s] : cur.filter((x) => x !== s)));
  const plan = planFor(picked);
  const pastedFacebook = parsed.kind === "website" && isFacebookUrl(parsed.url);
  const fromLead = [
    prefill.instagramHandle && `IG @${prefill.instagramHandle}`,
    prefill.tiktokHandle && `TikTok @${prefill.tiktokHandle}`,
    prefill.website && prefill.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""),
    prefill.googleMapsUrl && "Google Maps pin",
  ].filter(Boolean) as string[];
  const source = planSources.find((p) => p.id === copyFrom);

  return (
    <ActionForm action={onboardNewClientAction} className="group/onb flex flex-col gap-5" ariaLabel="New client">
      {prefill.leadId && <input type="hidden" name="leadId" value={prefill.leadId} />}
      {/* Lead details ride along; a pasted link in the big field wins over the matching one. */}
      {prefill.instagramHandle && <input type="hidden" name="instagramHandle" value={prefill.instagramHandle} />}
      {prefill.tiktokHandle && <input type="hidden" name="tiktokHandle" value={prefill.tiktokHandle} />}
      {prefill.website && <input type="hidden" name="website" value={prefill.website} />}
      {prefill.googleMapsUrl && <input type="hidden" name="googleMapsUrl" value={prefill.googleMapsUrl} />}

      <div>
        <label className="label" htmlFor="onb-q">Business name or link</label>
        <input
          id="onb-q"
          name="q"
          required
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={!prefill.name}
          autoComplete="off"
          autoCapitalize={isLink ? "none" : "words"}
          spellCheck={false}
          enterKeyHint={isLink ? "next" : "go"}
          className="input py-3 font-medium"
          style={{ fontSize: 18 }}
          placeholder="e.g. Poke Bros"
        />
        {isLink ? (
          <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-sm text-ok" role="status">
            <span aria-hidden>✓</span>
            <span className="truncate">{pastedFacebook ? "Facebook Page" : PARSED_LABEL[parsed.kind]} · {parsedText(parsed)}</span>
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-muted">Or paste their Instagram, Facebook, TikTok, Google Maps or website link.</p>
        )}
        {fromLead.length > 0 && <p className="mt-1.5 text-xs text-muted">From the lead: {fromLead.join(" · ")}</p>}
      </div>

      {isLink && (
        <div>
          <label className="label" htmlFor="onb-name">Business name</label>
          <input id="onb-name" name="name" required autoFocus autoComplete="off" className="input font-medium" style={{ fontSize: 18 }} placeholder="e.g. Poke Bros" />
        </div>
      )}

      <div>
        <label className="label" htmlFor="onb-city">City <span className="font-normal">(optional)</span></label>
        <input id="onb-city" name="location" defaultValue={prefill.location ?? ""} autoComplete="off" className="input" placeholder="e.g. Richmond" />
      </div>

      <fieldset className="min-w-0">
        <legend className="label">What we&apos;ll do for them</legend>
        <p className="-mt-0.5 mb-2 text-xs text-muted">Tap to pick or unpick. You can change this later.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SERVICES.map((s) => (
            <label
              key={s}
              className={cx(
                "group flex min-h-14 cursor-pointer select-none flex-col items-start justify-center rounded-xl border border-border px-3 py-2 text-left leading-tight transition",
                "has-[:checked]:border-accent has-[:checked]:bg-accent-soft",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
              )}
            >
              <input
                type="checkbox"
                id={`onb-svc-${s}`}
                name="services"
                value={s}
                checked={picked.includes(s)}
                onChange={(e) => toggle(s, e.target.checked)}
                className="sr-only"
              />
              <span className="flex items-center gap-1.5 text-sm font-medium group-has-[:checked]:text-accent">
                <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded border border-border text-[10px] group-has-[:checked]:border-accent group-has-[:checked]:bg-accent group-has-[:checked]:text-accent-fg">
                  <span className="hidden group-has-[:checked]:inline">✓</span>
                </span>
                {SERVICE_LABELS[s]}
              </span>
              <span className="mt-0.5 pl-5.5 text-xs text-muted">{SERVICE_HINTS[s]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Shown by CSS when the chip is checked, so it also works before JS loads. */}
      <div className="hidden group-has-[#onb-svc-creators:checked]/onb:block">
        <OutreachAreasField idPrefix="onb" defaultValue={prefill.outreachAreas} />
      </div>

      {!pastedFacebook && (
        <div className="hidden group-has-[#onb-svc-facebook:checked]/onb:block">
          <label className="label" htmlFor="onb-fb">Facebook Page link <span className="font-normal">(optional)</span></label>
          <input id="onb-fb" name="facebookPage" autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="url" className="input" placeholder="facebook.com/their-page" />
          <p className="mt-1.5 text-xs text-muted">Saved in the business notes.</p>
        </div>
      )}

      {!source && plan.length > 0 && (
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-sm font-medium">Monthly plan <span className="text-xs font-normal text-muted">({STARTING_PLAN_NOTE})</span></p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {plan.map((p) => (
              <li key={p.title} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformTag platform={p.platform} />
                  <span className="truncate">{p.title}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{p.targetPerMonth ? `${p.targetPerMonth} / month` : "as needed"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Change the numbers anytime in Settings &amp; plan.</p>
        </div>
      )}

      {planSources.length > 0 && (
        <div>
          <label className="label" htmlFor="onb-copy">Monthly plan</label>
          <select id="onb-copy" name="copyPlanFrom" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="input">
            <option value="">Starting plan for these services</option>
            {planSources.map((p) => (
              <option key={p.id} value={p.id}>Copy from {p.name} ({p.items} item{p.items === 1 ? "" : "s"})</option>
            ))}
          </select>
          {source && <p className="mt-1.5 text-xs text-muted">Uses {source.name}&apos;s plan instead. You can tweak it later in Settings &amp; plan.</p>}
        </div>
      )}

      <div className="sticky-actions -mx-1 flex flex-col gap-2 rounded-xl bg-surface/95 px-1 py-2 backdrop-blur sm:flex-row sm:items-center">
        <SubmitButton pendingLabel="Setting up…" className="w-full sm:w-auto">
          {prefill.leadId ? "Start managing" : "Add client"}
        </SubmitButton>
        <p className="text-xs text-muted">Sets up the plan and a short checklist. Claude starts the research right away.</p>
      </div>
    </ActionForm>
  );
}
