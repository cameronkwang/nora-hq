import type { LeadOpportunity } from "@/lib/schema";
import { OPP_SHORT } from "@/app/(app)/leads/shared";
import { Tag, cx } from "./ui";

/** Small presentational pieces for leads. Server-component safe (no hooks). */

/** What we could do for them (Google, Social, Collab): facts about the lead, so outlined tags. */
export function OppChips({ opportunities, className }: { opportunities: readonly LeadOpportunity[]; className?: string }) {
  if (!opportunities.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-1.5", className)}>
      {opportunities.map((o) => (
        <Tag key={o} bare>{OPP_SHORT[o]}</Tag>
      ))}
    </span>
  );
}

/** 0–100 fit score: one thin ink line and the number (no traffic-light colours). */
export function ScoreBar({ score, className }: { score: number | null; className?: string }) {
  if (score == null) return <span className={cx("text-sm text-muted", className)}>No score</span>;
  return (
    <span className={cx("inline-flex items-baseline gap-2 text-sm text-muted", className)} title={`Fit score ${score} of 100`}>
      <span className="bar w-14 self-center" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Fit score">
        <i style={{ width: `${Math.max(4, score)}%` }} />
      </span>
      <span className="tabular-nums">{score}</span>
    </span>
  );
}

/** "Next step Nov 14"; the words "Overdue" (danger) and "today" (warn) carry the colour, as "Due today" does elsewhere. */
export function NextStep({ date, today, className }: { date: string | null; today: string; className?: string }) {
  if (!date) return null;
  const overdue = date < today;
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <span className={cx("whitespace-nowrap text-sm", overdue ? "font-medium text-danger" : date === today ? "font-medium text-warn" : "text-muted", className)}>
      {overdue ? `Overdue · ${label}` : date === today ? "Next step today" : `Next step ${label}`}
    </span>
  );
}
