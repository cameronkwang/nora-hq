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
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
            {lead.name}
          </Link>
          <OppChips opportunities={lead.opportunities} />
        </div>
        {where && <p className="truncate text-xs text-muted">{where}</p>}
        {(s.google || s.social) && (
          <p className="mt-0.5 text-sm">
            {[s.google, s.social].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:shrink-0 sm:justify-end">
        <ScoreBar score={lead.score} />
        <NextStep date={lead.nextStepAt} today={today} />
        <form action={moveLeadStageAction} className="ml-auto sm:ml-0">
          <input type="hidden" name="id" value={lead.id} />
          <input type="hidden" name="back" value={back} />
          <OutreachStageSelect current={lead.stage} label={`Stage for ${lead.name}`} stages={LEAD_STAGES} />
        </form>
      </div>
    </li>
  );
}

/** Compact card for the board view. */
export function LeadCard({ lead, today, back, now }: { lead: Lead; today: string; back: string; now: Date }) {
  const s = leadSignals(lead, now);
  return (
    <div className="mb-2 rounded-lg border border-border bg-surface p-3 text-sm shadow-sm">
      <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">{lead.name}</Link>
      {lead.city && <p className="truncate text-xs text-muted">{lead.city}</p>}
      <OppChips opportunities={lead.opportunities} className="mt-1" />
      {(s.google || s.social) && <p className="mt-1 text-xs">{[s.google, s.social].filter(Boolean).join(" · ")}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ScoreBar score={lead.score} />
        <NextStep date={lead.nextStepAt} today={today} />
      </div>
      <form action={moveLeadStageAction} className="mt-2">
        <input type="hidden" name="id" value={lead.id} />
        <input type="hidden" name="back" value={back} />
        <OutreachStageSelect current={lead.stage} label={`Stage for ${lead.name}`} stages={LEAD_STAGES} />
      </form>
    </div>
  );
}
