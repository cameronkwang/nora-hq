import Link from "next/link";
import type { Creator, Outreach } from "@/lib/schema";
import { OUTREACH_STAGES } from "@/lib/schema";
import { formatDate } from "@/lib/dates";
import { OutreachBoard } from "./outreach-board";
import { OutreachStageSelect } from "./outreach-stage-select";
import { Badge, PlatformTag, formatNumber, humanize } from "./ui";

export type PipelineRow = Outreach & { creator: Creator };

const MAIN: readonly string[] = ["sourced", "shortlisted", "contacted", "followed_up", "replied", "negotiating", "agreed", "visit_scheduled", "posted"];
const CLOSED: readonly string[] = ["declined", "no_response"];
const COMP_SHORT: Record<string, string> = { gifted: "Gifted", paid: "Paid", affiliate: "Affiliate", tbd: "" };

/**
 * Kanban-style board for one business. Desktop: columns side by side, scrolling inside their own box.
 * Phones: one stage at a time with a stage switcher (see OutreachBoard).
 */
export function OutreachPipeline({
  rows,
  back,
  moveAction,
  now = new Date(),
}: {
  rows: PipelineRow[];
  back: string;
  moveAction: (fd: FormData) => Promise<void>;
  now?: Date;
}) {
  const byStage = (s: string) => rows.filter((r) => r.stage === s);
  const closed = rows.filter((r) => CLOSED.includes(r.stage));
  return (
    <div className="space-y-4">
      <OutreachBoard
        columns={MAIN.map((stage) => {
          const items = byStage(stage);
          return {
            stage,
            label: humanize(stage),
            count: items.length,
            content: (
              <ul className="flex flex-1 flex-col gap-2">
                {items.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-border px-2 py-4 text-center text-xs text-muted">Nobody here</li>
                ) : (
                  items.map((r) => <PipelineCard key={r.id} row={r} back={back} moveAction={moveAction} now={now} />)
                )}
              </ul>
            ),
          };
        })}
      />

      <details className="rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Declined or no response <span className="tabular-nums text-muted">({closed.length})</span>
        </summary>
        <div className="border-t border-border p-3">
          {closed.length === 0 ? (
            <p className="text-sm text-muted">No closed-out creators for this business.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {closed.map((r) => <PipelineCard key={r.id} row={r} back={back} moveAction={moveAction} now={now} />)}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}

function PipelineCard({ row: r, back, moveAction, now }: { row: PipelineRow; back: string; moveAction: (fd: FormData) => Promise<void>; now: Date }) {
  const c = r.creator;
  const due = !!r.nextFollowUpAt && r.nextFollowUpAt <= now && (r.stage === "contacted" || r.stage === "followed_up");
  const followers = Math.max(c.instagramFollowers ?? 0, c.tiktokFollowers ?? 0);
  return (
    <li className="rounded-lg border border-border bg-surface p-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/creators/${c.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
          {c.name}
        </Link>
        {followers > 0 && <span className="shrink-0 text-xs tabular-nums text-muted">{formatNumber(followers)}</span>}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted">
        {c.instagramHandle ? `@${c.instagramHandle}` : c.tiktokHandle ? `@${c.tiktokHandle}` : (c.email ?? "")}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <PlatformTag platform={r.channel} />
        {COMP_SHORT[r.compType] && <Badge>{COMP_SHORT[r.compType]}</Badge>}
        {c.doNotContact && <Badge tone="danger">Do not contact</Badge>}
        {due && <Badge tone="warn">Follow up due</Badge>}
        {!due && r.nextFollowUpAt && !CLOSED.includes(r.stage) && r.stage !== "posted" && (
          <span className="text-xs text-muted">Follow up {formatDate(r.nextFollowUpAt)}</span>
        )}
      </div>
      <form action={moveAction} className="mt-2">
        <input type="hidden" name="clientId" value={r.clientId} />
        <input type="hidden" name="creatorId" value={r.creatorId} />
        <input type="hidden" name="channel" value={r.channel} />
        <input type="hidden" name="back" value={back} />
        <OutreachStageSelect current={r.stage} stages={OUTREACH_STAGES} label={`Move ${c.name} to stage`} />
      </form>
    </li>
  );
}
