import { OUTREACH_AREA_CHIPS, splitOutreachAreas } from "@/lib/onboard-services";
import { cx } from "./ui";

/**
 * "Where should we look for creators?" — quick chips (Richmond, 757 / Hampton Roads) plus free text.
 * Posts `outreachArea` (one per checked chip) and `outreachAreasOther`; the server joins them with
 * joinOutreachAreas(). Plain inputs, so it works before JS loads. Used on New client and Settings.
 */
export function OutreachAreasField({
  idPrefix,
  defaultValue,
  label = "Where should we look for creators?",
  hint = "Pick one or both, or type other towns. Claude searches these areas for local food creators.",
}: {
  idPrefix: string;
  defaultValue?: string | null;
  label?: string;
  hint?: string;
}) {
  const { chips, other } = splitOutreachAreas(defaultValue);
  return (
    <fieldset className="min-w-0">
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {OUTREACH_AREA_CHIPS.map((c) => (
          <label
            key={c}
            className={cx(
              "group inline-flex min-h-10 cursor-pointer select-none items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition",
              "has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent",
              "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
            )}
          >
            <input type="checkbox" name="outreachArea" value={c} defaultChecked={chips.includes(c)} className="sr-only" />
            <span aria-hidden className="hidden group-has-[:checked]:inline">✓</span>
            {c}
          </label>
        ))}
      </div>
      <label className="sr-only" htmlFor={`${idPrefix}-areas-other`}>Other areas</label>
      <input
        id={`${idPrefix}-areas-other`}
        name="outreachAreasOther"
        defaultValue={other}
        autoComplete="off"
        className="input mt-2"
        placeholder="Other areas, e.g. Williamsburg, Petersburg"
        maxLength={300}
      />
      <p className="mt-1.5 text-xs text-muted">{hint}</p>
    </fieldset>
  );
}
