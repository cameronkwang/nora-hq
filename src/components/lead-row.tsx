import Link from "next/link";
import { LEAD_STAGES, type Lead } from "@/lib/schema";
import { leadSignals } from "@/app/(app)/leads/shared";
import { moveLeadStageAction } from "@/app/(app)/leads/actions";
import { OutreachStageSelect } from "./outreach-stage-select";
import { NextStep, OppChips, ScoreBar } from "./lead-bits";

/** One lead in the list: who, what for, the key signal in plain words, fit, next step, and an inline stage picker. */
export function LeadRow({ lead, today, back, now }: { lead: Lead; today: string; back: string; now: Date }) {
  const s = leadSignals(lead, now);
  const where = [lead.city, lead.category].filter(Boolean).join(" · ");
  return (
    <li className="g-lead">
      <div className="head">
        <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
        <OppChips opportunities={lead.opportunities} />
      </div>
      <p className="more g-dots">
        {where && <span>{where}</span>}
        <ScoreBar score={lead.score} />
        {lead.nextStepAt && <NextStep date={lead.nextStepAt} today={today} />}
      </p>
      {(s.google || s.social) && <p className="signal">{[s.google, s.social].filter(Boolean).join(" · ")}</p>}
      <form action={moveLeadStageAction}>
        <input type="hidden" name="id" value={lead.id} />
        <input type="hidden" name="back" value={back} />
        <OutreachStageSelect current={lead.stage} label={`Stage for ${lead.name}`} stages={LEAD_STAGES} />
      </form>
    </li>
  );
}

/** Compact item for the board view. */
export function LeadCard({ lead, today, back, now }: { lead: Lead; today: string; back: string; now: Date }) {
  const s = leadSignals(lead, now);
  return (
    <li className="g-card">
      <Link href={`/leads/${lead.id}`}>{lead.name}</Link>
      {lead.city && <p className="more truncate">{lead.city}</p>}
      <OppChips opportunities={lead.opportunities} className="mt-1" />
      {(s.google || s.social) && <p className="mt-1 text-sm">{[s.google, s.social].filter(Boolean).join(" · ")}</p>}
      <div className="facts">
        <ScoreBar score={lead.score} />
        <NextStep date={lead.nextStepAt} today={today} />
      </div>
      <form action={moveLeadStageAction}>
        <input type="hidden" name="id" value={lead.id} />
        <input type="hidden" name="back" value={back} />
        <OutreachStageSelect current={lead.stage} label={`Stage for ${lead.name}`} stages={LEAD_STAGES} />
      </form>
    </li>
  );
}
