import type { Lead, LeadOpportunity } from "@/lib/schema";
import { LEAD_OPPORTUNITIES } from "@/lib/schema";
import { OPP_LABEL } from "@/app/(app)/leads/shared";

/**
 * Lead form fields (add + edit). The essentials up front; the research facts behind "More details".
 * Server-component safe: plain inputs, read by leads/actions.ts.
 */
export function LeadFields({ lead, idPrefix = "lf", openMore = false }: { lead?: Lead | null; idPrefix?: string; openMore?: boolean }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const v = (x: string | number | null | undefined) => (x == null ? "" : String(x));
  const date = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={id("name")}>Business name</label>
          <input id={id("name")} name="name" required defaultValue={v(lead?.name)} className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor={id("city")}>City</label>
          <input id={id("city")} name="city" defaultValue={v(lead?.city)} placeholder="e.g. Richmond, VA" className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor={id("ig")}>Instagram</label>
          <input id={id("ig")} name="instagramHandle" defaultValue={v(lead?.instagramHandle)} placeholder="@handle" className="input" autoComplete="off" autoCapitalize="none" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={id("web")}>Website</label>
          <input id={id("web")} name="website" type="text" inputMode="url" defaultValue={v(lead?.website)} placeholder="example.com" className="input" autoComplete="off" autoCapitalize="none" />
        </div>
      </div>

      <OpportunityPicker selected={lead?.opportunities ?? []} />

      <details className="group rounded-lg border border-border" open={openMore || undefined}>
        <summary className="no-marker flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-medium">
          More details
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
          <Field id={id("cat")} name="category" label="Type of place" value={v(lead?.category)} placeholder="e.g. Korean BBQ" />
          <Field id={id("maps")} name="googleMapsUrl" label="Google Maps link" value={v(lead?.googleMapsUrl)} inputMode="url" />
          <Field id={id("rating")} name="googleRating" label="Google rating" value={v(lead?.googleRating)} placeholder="4.3" inputMode="decimal" />
          <Field id={id("reviews")} name="googleReviewCount" label="Google reviews" value={v(lead?.googleReviewCount)} placeholder="312" inputMode="numeric" />
          <Field id={id("reply")} name="replyRate" label="Owner replies to (%)" value={v(lead?.replyRate)} placeholder="5" inputMode="numeric" />
          <Field id={id("igf")} name="instagramFollowers" label="IG followers" value={v(lead?.instagramFollowers)} placeholder="2.1k" />
          <Field id={id("last")} name="lastPostAt" label="Last IG post" value={date(lead?.lastPostAt)} type="date" />
          <Field id={id("tt")} name="tiktokHandle" label="TikTok" value={v(lead?.tiktokHandle)} placeholder="@handle" />
          <Field id={id("score")} name="score" label="Fit score (0–100)" value={v(lead?.score)} inputMode="numeric" />
          <Field id={id("next")} name="nextStepAt" label="Next step" value={v(lead?.nextStepAt)} type="date" />
          <div className="sm:col-span-2">
            <label className="label" htmlFor={id("why")}>Why they’re a fit</label>
            <textarea id={id("why")} name="why" defaultValue={v(lead?.why)} rows={3} className="input" placeholder="The gap we’d fix, in a sentence or two." />
          </div>
          <p className="text-xs text-muted sm:col-span-2">Contact: only public business info (website, Google profile, Instagram bio).</p>
          <Field id={id("cname")} name="contactName" label="Contact name" value={v(lead?.contactName)} />
          <Field id={id("cemail")} name="contactEmail" label="Public business email" value={v(lead?.contactEmail)} type="email" />
          <Field id={id("cphone")} name="contactPhone" label="Business phone" value={v(lead?.contactPhone)} type="tel" />
          <div className="sm:col-span-2">
            <label className="label" htmlFor={id("notes")}>Notes</label>
            <textarea id={id("notes")} name="notes" defaultValue={v(lead?.notes)} rows={3} className="input" />
          </div>
        </div>
      </details>
    </div>
  );
}

export function OpportunityPicker({ selected, legend = "What could we do for them?" }: { selected: readonly LeadOpportunity[]; legend?: string }) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {LEAD_OPPORTUNITIES.map((o) => (
          <label key={o} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft md:min-h-9">
            <input type="checkbox" name="opportunities" value={o} defaultChecked={selected.includes(o)} />
            {OPP_LABEL[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Field({
  id, name, label, value, placeholder, type = "text", inputMode,
}: {
  id: string; name: string; label: string; value: string; placeholder?: string; type?: string;
  inputMode?: "text" | "decimal" | "numeric" | "url" | "email" | "tel";
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} inputMode={inputMode} defaultValue={value} placeholder={placeholder} className="input" autoComplete="off" />
    </div>
  );
}
