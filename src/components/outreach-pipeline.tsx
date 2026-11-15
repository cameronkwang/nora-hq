import Link from "next/link";
import type { Creator, Outreach } from "@/lib/schema";
import { OUTREACH_STAGES } from "@/lib/schema";
import { formatDate } from "@/lib/dates";
import { OutreachBoard } from "./outreach-board";
import { OutreachStageSelect } from "./outreach-stage-select";
import { PlatformTag, Status, Tag, formatNumber, humanize } from "./ui";

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
    <div>
      <OutreachBoard
        columns={MAIN.map((stage) => {
          const items = byStage(stage);
          return {
            stage,
            label: humanize(stage),
            count: items.length,
            content:
              items.length === 0 ? (
                <p key={stage} className="g-col-empty">Nobody here</p>
              ) : (
                <ul key={stage} className="list">
                  {items.map((r) => <PipelineCard key={r.id} row={r} back={back} moveAction={moveAction} now={now} />)}
                </ul>
              ),
          };
        })}
      />

      <details className="sec g-fold">
        <summary className="sec-head">
          <span className="title">
            Declined or no response<span className="meta num">{closed.length}</span>
          </span>
          <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </summary>
        {closed.length === 0 ? (
          <p className="empty meta">No closed-out creators for this business.</p>
        ) : (
          <ul className="g-cards grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {closed.map((r) => <PipelineCard key={r.id} row={r} back={back} moveAction={moveAction} now={now} />)}
          </ul>
        )}
      </details>
    </div>
  );
}

function PipelineCard({ row: r, back, moveAction, now }: { row: PipelineRow; back: string; moveAction: (fd: FormData) => Promise<void>; now: Date }) {
  const c = r.creator;
  const due = !!r.nextFollowUpAt && r.nextFollowUpAt <= now && (r.stage === "contacted" || r.stage === "followed_up");
  const followers = Math.max(c.instagramFollowers ?? 0, c.tiktokFollowers ?? 0);
  return (
    <li className="g-card">
      <Link href={`/creators/${c.id}`}>{c.name}</Link>
      <p className="more truncate">
        {c.instagramHandle ? `@${c.instagramHandle}` : c.tiktokHandle ? `@${c.tiktokHandle}` : (c.email ?? "")}
        {followers > 0 && <span className="num"> · {formatNumber(followers)}</span>}
      </p>
      <div className="facts">
        <PlatformTag platform={r.channel} />
        {COMP_SHORT[r.compType] && <Tag bare>{COMP_SHORT[r.compType]}</Tag>}
        {c.doNotContact && <Status tone="danger" small>Do not contact</Status>}
        {due && <Status tone="warn" small>Follow up due</Status>}
        {!due && r.nextFollowUpAt && !CLOSED.includes(r.stage) && r.stage !== "posted" && (
          <span>Follow up {formatDate(r.nextFollowUpAt)}</span>
        )}
      </div>
      <form action={moveAction}>
        <input type="hidden" name="clientId" value={r.clientId} />
        <input type="hidden" name="creatorId" value={r.creatorId} />
        <input type="hidden" name="channel" value={r.channel} />
        <input type="hidden" name="back" value={back} />
        <OutreachStageSelect current={r.stage} stages={OUTREACH_STAGES} label={`Move ${c.name} to stage`} />
      </form>
    </li>
  );
}
