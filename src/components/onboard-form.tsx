"use client";

import { useState } from "react";
import { onboardAction } from "@/app/(app)/clients/actions";
import { PARSED_LABEL, parseBusinessInput, parsedText } from "@/lib/onboard-parse";
import { ActionForm, SubmitButton } from "./client-form";
import { cx } from "./ui";

type Service = "social" | "google" | "collab";

const SERVICE_CHIPS: Array<{ value: Service; label: string }> = [
  { value: "social", label: "Social media" },
  { value: "google", label: "Google reviews" },
  { value: "collab", label: "Creator collab" },
];

export type OnboardPrefill = {
  leadId?: string | null;
  name?: string | null;
  location?: string | null;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
  website?: string | null;
  googleMapsUrl?: string | null;
  services?: Service[];
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
  const services = prefill.services?.length ? prefill.services : (["social", "google"] as Service[]);
  const fromLead = [
    prefill.instagramHandle && `IG @${prefill.instagramHandle}`,
    prefill.tiktokHandle && `TikTok @${prefill.tiktokHandle}`,
    prefill.website && prefill.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""),
    prefill.googleMapsUrl && "Google Maps pin",
  ].filter(Boolean) as string[];
  const source = planSources.find((p) => p.id === copyFrom);

  return (
    <ActionForm action={onboardAction} className="flex flex-col gap-5" ariaLabel="New client">
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
            <span className="truncate">{PARSED_LABEL[parsed.kind]} · {parsedText(parsed)}</span>
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-muted">Or paste their Instagram, TikTok, Google Maps or website link.</p>
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
        <div className="grid grid-cols-3 gap-2">
          {SERVICE_CHIPS.map((s) => (
            <label
              key={s.value}
              className={cx(
                "flex min-h-12 cursor-pointer select-none items-center justify-center rounded-xl border border-border px-2 py-2 text-center text-sm font-medium leading-tight transition",
                "has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
              )}
            >
              <input type="checkbox" name="services" value={s.value} defaultChecked={services.includes(s.value)} className="sr-only" />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>

      {planSources.length > 0 && (
        <div>
          <label className="label" htmlFor="onb-copy">Monthly plan</label>
          <select id="onb-copy" name="copyPlanFrom" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="input">
            <option value="">Standard plan for these services</option>
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
