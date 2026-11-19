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
import { PlatformTag, humanize } from "./ui";

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
 * New client: one screen, one required field. "Business name or link" also takes a pasted
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
    <ActionForm action={onboardNewClientAction} className="group/onb flex flex-col gap-6" ariaLabel="New client">
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
          className="input h-12 font-medium"
          style={{ fontSize: 18 }}
          placeholder="e.g. Poke Bros"
        />
        {isLink ? (
          <p className="status is-ok mt-2 flex max-w-full whitespace-normal" role="status">
            <span className="min-w-0 break-words">{pastedFacebook ? "Facebook Page" : PARSED_LABEL[parsed.kind]} · {parsedText(parsed)}</span>
          </p>
        ) : (
          <p className="hint">Or paste their Instagram, Facebook, TikTok, Google Maps or website link.</p>
        )}
        {fromLead.length > 0 && <p className="hint">From the lead: {fromLead.join(" · ")}</p>}
      </div>

      {isLink && (
        <div>
          <label className="label" htmlFor="onb-name">Business name</label>
          <input id="onb-name" name="name" required autoFocus autoComplete="off" className="input h-12 font-medium" style={{ fontSize: 18 }} placeholder="e.g. Poke Bros" />
        </div>
      )}

      <div>
        <label className="label" htmlFor="onb-city">City <span className="font-normal text-muted">(optional)</span></label>
        <input id="onb-city" name="location" defaultValue={prefill.location ?? ""} autoComplete="off" className="input" placeholder="e.g. Richmond" />
      </div>

      <fieldset className="min-w-0">
        <legend className="label">What we&apos;ll do for them</legend>
        <div className="svc-grid">
          {SERVICES.map((sv) => (
            <label key={sv} className="svc">
              <input
                type="checkbox"
                id={`onb-svc-${sv}`}
                name="services"
                value={sv}
                checked={picked.includes(sv)}
                onChange={(e) => toggle(sv, e.target.checked)}
                className="check"
              />
              <span>
                <b>{SERVICE_LABELS[sv]}</b>
                <span>{SERVICE_HINTS[sv]}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="hint">Tap to pick or unpick. You can change this later.</p>
      </fieldset>

      {/* Shown by CSS when the chip is checked, so it also works before JS loads. */}
      <div className="hidden group-has-[#onb-svc-creators:checked]/onb:block">
        <OutreachAreasField idPrefix="onb" defaultValue={prefill.outreachAreas} />
      </div>

      {!pastedFacebook && (
        <div className="hidden group-has-[#onb-svc-facebook:checked]/onb:block">
          <label className="label" htmlFor="onb-fb">Facebook Page link <span className="font-normal text-muted">(optional)</span></label>
          <input id="onb-fb" name="facebookPage" autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="url" className="input" placeholder="facebook.com/their-page" />
          <p className="hint">Saved in the business notes.</p>
        </div>
      )}

      {!source && plan.length > 0 && (
        <div>
          <p className="label">Monthly plan <span className="font-normal text-muted">({STARTING_PLAN_NOTE.replace(" — ", ": ")})</span></p>
          <ul className="plan-preview border-y border-border">
            {plan.map((p) => {
              // The platform is only spelled out when the item's own name doesn't already say it.
              const named = p.platform === "other" || p.title.toLowerCase().includes((p.platform === "tiktok" ? "TikTok" : humanize(p.platform)).toLowerCase());
              return (
                <li key={p.title}>
                  <span className="min-w-0">
                    {p.title}
                    {!named && <PlatformTag platform={p.platform} className="ml-2" />}
                  </span>
                  <span className="meta num shrink-0">{p.targetPerMonth ? `${p.targetPerMonth} / month` : "as needed"}</span>
                </li>
              );
            })}
          </ul>
          <p className="hint">Change the numbers anytime in Settings &amp; plan.</p>
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
          {source && <p className="hint">Uses {source.name}&apos;s plan instead. You can tweak it later in Settings &amp; plan.</p>}
        </div>
      )}

      {/* The screen's one focal action (ink inside the app; New ask stays the only cinnabar). A bar that stays in reach:
          solid paper, a hairline on top, kept short so the focus clearance covers it. */}
      <div className="sticky-actions">
        <div className="action-bar flex items-center gap-x-4">
          <SubmitButton variant="primary" pendingLabel="Setting up…" className="shrink-0">
            {prefill.leadId ? "Start managing" : "Add client"}
          </SubmitButton>
          <p className="meta min-w-0 flex-1 leading-5">Sets up the plan and a short checklist. Claude starts the research right away.</p>
        </div>
      </div>
    </ActionForm>
  );
}
