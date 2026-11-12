import type { CollabRequestStatus } from "@/lib/schema";
import { CopyButton } from "./copy-button";
import { Badge, Card, cx } from "./ui";

/** Small presentational pieces for the collab inbox. Server-component safe. */

export const COLLAB_STATUS_LABEL: Record<CollabRequestStatus, string> = {
  new: "New", reviewing: "Reviewing", accepted: "Accepted", declined: "Declined", spam: "Spam",
};
const TONE: Record<CollabRequestStatus, "accent" | "info" | "ok" | "neutral" | "danger"> = {
  new: "accent", reviewing: "info", accepted: "ok", declined: "neutral", spam: "neutral",
};

export function CollabStatusBadge({ status }: { status: CollabRequestStatus }) {
  return <Badge tone={TONE[status]}>{COLLAB_STATUS_LABEL[status]}</Badge>;
}

/** "Dine-in feature / tasting, Giveaway" → chips. */
export function CollabTypeChips({ types, className }: { types: string | null; className?: string }) {
  const list = (types ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap gap-1", className)}>
      {list.map((t) => (
        <span key={t} className="whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">{t}</span>
      ))}
    </span>
  );
}

/** "Paid collaboration · $500–1,000" with paid offers highlighted. */
export function CollabComp({ compensation, budget }: { compensation: string | null; budget: string | null }) {
  if (!compensation) return null;
  const paid = /paid/i.test(compensation);
  return (
    <span className={cx("text-sm", paid ? "font-semibold text-ok" : "text-muted")}>
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
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input readOnly value={url} aria-label="Collab form link" className="input min-w-0 flex-1 font-mono text-xs" id="collab-share-url" />
        <div className="flex gap-2">
          <CopyButton text={url} label="Copy link" variant="primary" />
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
            Preview ↗
          </a>
        </div>
      </div>
    </Card>
  );
}
