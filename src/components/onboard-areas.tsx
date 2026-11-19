import { OUTREACH_AREA_CHIPS, splitOutreachAreas } from "@/lib/onboard-services";

/**
 * "Where should we look for creators?": quick picks (Richmond, 757 / Hampton Roads) plus free text.
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
      <div className="flex flex-wrap">
        {OUTREACH_AREA_CHIPS.map((c) => (
          <label key={c} className="opt">
            <input type="checkbox" name="outreachArea" value={c} defaultChecked={chips.includes(c)} className="check" />
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
        className="input mt-1"
        placeholder="Other areas, e.g. Williamsburg, Petersburg"
        maxLength={300}
      />
      <p className="hint">{hint}</p>
    </fieldset>
  );
}
