import { OUTREACH_STAGES } from "@/lib/schema";
import { humanize } from "./ui";

/** Select inputs for an outreach relationship. Server-component safe. `idPrefix` keeps label ids unique per form. */

const CHANNELS: Array<[string, string]> = [["instagram_dm", "Instagram DM"], ["tiktok_dm", "TikTok DM"], ["email", "Email"]];
const COMPS: Array<[string, string]> = [["tbd", "Comp TBD"], ["gifted", "Gifted meal"], ["paid", "Paid"], ["affiliate", "Affiliate"]];

export function ChannelSelect({ idPrefix, defaultValue = "instagram_dm" }: { idPrefix: string; defaultValue?: string }) {
  return (
    <div>
      <label className="label" htmlFor={`${idPrefix}-channel`}>Channel</label>
      <select id={`${idPrefix}-channel`} name="channel" className="input" defaultValue={defaultValue}>
        {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export function CompSelect({ idPrefix, defaultValue = "tbd" }: { idPrefix: string; defaultValue?: string }) {
  return (
    <div>
      <label className="label" htmlFor={`${idPrefix}-comp`}>Comp</label>
      <select id={`${idPrefix}-comp`} name="compType" className="input" defaultValue={defaultValue}>
        {COMPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export function StageSelect({ idPrefix, defaultValue = "shortlisted", stages = OUTREACH_STAGES }: { idPrefix: string; defaultValue?: string; stages?: readonly string[] }) {
  return (
    <div>
      <label className="label" htmlFor={`${idPrefix}-stage`}>Stage</label>
      <select id={`${idPrefix}-stage`} name="stage" className="input" defaultValue={defaultValue}>
        {stages.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
      </select>
    </div>
  );
}
