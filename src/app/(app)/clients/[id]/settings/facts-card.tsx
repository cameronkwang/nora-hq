import { formatDate } from "@/lib/dates";
import type { schema } from "@/lib/db";
import {
  FACT_LABEL, OWNER_SOURCE, PRICE_RANGES, PRICE_RANGE_HINT, businessFacts, checkerName, factsChecklist, readPublicInfo, sourceLabel,
  type FactKey, type InfoFactKey,
} from "@/lib/business-facts";
import { ActionForm, SubmitButton } from "@/components/client-form";
import { Card } from "@/components/ui";
import { saveBusinessFactsAction } from "./actions";

/**
 * Settings → Public facts: what anyone can find about the business (address, phone, hours, Facebook Page, Google
 * listing, what they sell, price range). Claude fills these in before the onboarding form is sent; a person can fix
 * them here. The form shows them back to the owner as one "Is this right?" card, so the owner never types them.
 */

const PLACEHOLDER: Record<InfoFactKey, string> = {
  address: "123 Main St, Richmond, VA 23220",
  phone: "(804) 555-0123",
  hours: "Mon–Thu 11am–9pm\nFri–Sat 11am–10pm\nSun closed",
  facebook: "facebook.com/their-page",
  googleListing: "https://maps.app.goo.gl/…",
  sells: "Sichuan hot pot, bubble tea",
  priceRange: "",
};

export function FactsCard({ client }: { client: schema.Client }) {
  const facts = businessFacts(client);
  const info = readPublicInfo(client.publicInfo);
  const check = factsChecklist(client);
  const notFound = new Set<FactKey>(info.notFound ?? []);
  const elsewhere = (["website", "instagram", "tiktok"] as const).map((k) => `${FACT_LABEL[k]}${facts[k] ? "" : notFound.has(k) ? " (not found)" : " (missing)"}`).join(", ");

  const under = (key: InfoFactKey) => {
    const src = info.sources?.[key];
    if (facts[key] && src) {
      return (
        <p className="mt-1 text-xs text-muted">
          Source:{" "}
          {src === OWNER_SOURCE ? sourceLabel(src) : <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">{sourceLabel(src)}</a>}
        </p>
      );
    }
    if (!facts[key] && notFound.has(key)) return <p className="mt-1 text-xs text-muted">Looked for, not found.</p>;
    return null;
  };

  return (
    <Card title="Public facts">
      <p className="mb-3 text-xs text-muted">
        What anyone can find on Google Maps, their website or their socials. The onboarding form shows these to the owner as one “Is this right?” card, so they never have to type them. Claude looks them up before the form is sent; fix anything here.
      </p>
      <p data-facts-status="" className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs">
        {check.checkedAt ? <>Checked {formatDate(check.checkedAt)} by {checkerName(check.checkedBy)}. </> : <>Not researched yet. </>}
        {check.missing.length ? <>Still missing: {check.missing.map((m) => m.label).join(", ")}.</> : <>Nothing missing.</>}
      </p>

      <ActionForm action={saveBusinessFactsAction.bind(null, client.id)} className="flex flex-col gap-3" ariaLabel="Public facts">
        <div>
          <label className="label" htmlFor="pf-address">{FACT_LABEL.address}</label>
          <input id="pf-address" name="address" defaultValue={facts.address ?? ""} maxLength={300} className="input" placeholder={PLACEHOLDER.address} autoComplete="off" />
          {under("address")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pf-phone">{FACT_LABEL.phone}</label>
            <input id="pf-phone" name="phone" defaultValue={facts.phone ?? ""} maxLength={40} className="input" placeholder={PLACEHOLDER.phone} inputMode="tel" autoComplete="off" />
            {under("phone")}
          </div>
          <div>
            <label className="label" htmlFor="pf-price">{FACT_LABEL.priceRange}</label>
            <select id="pf-price" name="priceRange" defaultValue={facts.priceRange ?? ""} className="input">
              <option value="">Not set</option>
              {PRICE_RANGES.map((p) => (
                <option key={p} value={p}>{p} · {PRICE_RANGE_HINT[p]}</option>
              ))}
            </select>
            {under("priceRange")}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="pf-hours">{FACT_LABEL.hours}</label>
          <textarea id="pf-hours" name="hours" defaultValue={facts.hours ?? ""} maxLength={600} rows={3} className="input" placeholder={PLACEHOLDER.hours} />
          {under("hours")}
        </div>
        <div>
          <label className="label" htmlFor="pf-sells">{FACT_LABEL.sells}</label>
          <input id="pf-sells" name="sells" defaultValue={facts.sells ?? ""} maxLength={300} className="input" placeholder={PLACEHOLDER.sells} autoComplete="off" />
          {under("sells")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pf-facebook">{FACT_LABEL.facebook}</label>
            <input id="pf-facebook" name="facebook" defaultValue={facts.facebook ?? ""} maxLength={300} className="input" placeholder={PLACEHOLDER.facebook} inputMode="url" autoCapitalize="none" autoComplete="off" />
            {under("facebook")}
          </div>
          <div>
            <label className="label" htmlFor="pf-google">{FACT_LABEL.googleListing}</label>
            <input id="pf-google" name="googleListing" defaultValue={facts.googleListing ?? ""} maxLength={600} className="input" placeholder={PLACEHOLDER.googleListing} inputMode="url" autoCapitalize="none" autoComplete="off" />
            {under("googleListing")}
          </div>
        </div>
        <p className="text-xs text-muted">Also shown to the owner, edited under Details: {elsewhere}.</p>
        {check.missing.length > 0 && (
          <label className="inline-flex items-start gap-2 text-sm">
            <input type="checkbox" name="markRestNotFound" className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>We looked: mark the ones still empty as “not found”</span>
          </label>
        )}
        <div>
          <SubmitButton size="sm">Save facts</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

