import type { LeadOpportunity } from "@/lib/schema";
import { OPP_SHORT } from "@/app/(app)/leads/shared";
import { cx } from "./ui";

/** Small presentational pieces for leads. Server-component safe (no hooks). */

const OPP_CLS: Record<LeadOpportunity, string> = {
  google: "bg-info-soft text-google",
  social: "bg-accent-soft text-ig",
  collab: "bg-ok-soft text-ok",
};

export function OppChips({ opportunities, className }: { opportunities: readonly LeadOpportunity[]; className?: string }) {
  if (!opportunities.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap gap-1", className)}>
      {opportunities.map((o) => (
        <span key={o} className={cx("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", OPP_CLS[o])}>
          {OPP_SHORT[o]}
        </span>
      ))}
    </span>
  );
}

/** 0–100 fit score as a short bar with the number. */
export function ScoreBar({ score, className }: { score: number | null; className?: string }) {
  if (score == null) return <span className={cx("text-xs text-muted", className)}>No score</span>;
  const tone = score >= 70 ? "bg-ok" : score >= 40 ? "bg-accent" : "bg-muted";
  return (
    <span className={cx("inline-flex items-center gap-1.5", className)} title={`Fit score ${score} of 100`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Fit score">
        <span className={cx("block h-full rounded-full", tone)} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
      <span className="text-xs tabular-nums text-muted">{score}</span>
    </span>
  );
}

/** "Next step Nov 14", red when overdue. */
export function NextStep({ date, today, className }: { date: string | null; today: string; className?: string }) {
  if (!date) return null;
  const overdue = date < today;
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <span className={cx("whitespace-nowrap text-xs", overdue ? "font-semibold text-danger" : date === today ? "font-semibold text-warn" : "text-muted", className)}>
      {overdue ? `Overdue · ${label}` : date === today ? "Next step today" : `Next step ${label}`}
    </span>
  );
}
