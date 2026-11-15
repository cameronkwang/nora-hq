import type { CollabRequestStatus } from "@/lib/schema";
import { CopyButton } from "./copy-button";
import { Card, Status, Tag, buttonClass, cx, type Tone } from "./ui";

/** Small presentational pieces for the collab inbox. Server-component safe. */

export const COLLAB_STATUS_LABEL: Record<CollabRequestStatus, string> = {
  new: "New", reviewing: "Reviewing", accepted: "Accepted", declined: "Declined", spam: "Spam",
};
const TONE: Record<CollabRequestStatus, Tone> = {
  new: "accent", reviewing: "info", accepted: "ok", declined: "neutral", spam: "neutral",
};

export function CollabStatusBadge({ status, small = true }: { status: CollabRequestStatus; small?: boolean }) {
  return <Status tone={TONE[status]} small={small}>{COLLAB_STATUS_LABEL[status]}</Status>;
}

/** "Dine-in feature / tasting, Giveaway" → tags (facts about the request). */
export function CollabTypeChips({ types, className }: { types: string | null; className?: string }) {
  const list = (types ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-1", className)}>
      {list.map((t) => (
        <Tag key={t} bare>{t}</Tag>
      ))}
    </span>
  );
}

/** "Paid collaboration · $500–1,000": a paid offer reads in ink, anything else stays muted. No colour. */
export function CollabComp({ compensation, budget }: { compensation: string | null; budget: string | null }) {
  if (!compensation) return null;
  const paid = /paid/i.test(compensation);
  return (
    <span className={paid ? "font-medium text-text" : "text-muted"}>
      {compensation}
      {budget && <span className="font-normal"> · {budget}</span>}
    </span>
  );
}

/** The public form's address, with a copy button and a nudge to put it in the link-in-bio. */
export function CollabShareCard({ url, className }: { url: string; className?: string }) {
  return (
    <Card title="Share your form" className={className}>
      <p className="text-sm text-muted">Put this in your Instagram and TikTok link-in-bio, or paste it when a business DMs about working together.</p>
      <input readOnly value={url} aria-label="Collab form link" className="input mt-3 font-mono text-sm" id="collab-share-url" />
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton text={url} label="Copy link" />
        <a href={url} target="_blank" rel="noreferrer" className={buttonClass("ghost")}>
          Preview ↗
        </a>
      </div>
    </Card>
  );
}
