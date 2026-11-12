import Link from "next/link";
import type { Draft } from "@/lib/schema";
import type { DraftContext, OutreachContext } from "@/app/(app)/review/queries";
import { formatDate, monthLabel, relativeTime } from "@/lib/dates";
import { Badge, PlatformTag, StatusBadge, buttonClass, cx, formatNumber, humanize } from "./ui";
import { DraftEditor } from "./draft-editor";
import { postReviewKey } from "@/lib/post-key";
import { MediaStrip } from "./calendar-media";
import { MANUAL_SEND_KINDS, asksForPlatformReview, hasDisclosureLanguage, kindLabel } from "./draft-checks";
import { firstName, type ReplyCategory, type ReplyContext } from "./reply-fill";

const KIND_PLATFORM: Record<string, string> = {
  instagram_post: "instagram",
  tiktok_post: "tiktok",
  review_reply: "google",
  outreach_email: "email",
  lead_email: "email",
  comment_reply: "instagram",
};

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-xs text-muted">No rating</span>;
  return (
    <span className={cx("text-sm tracking-tight", rating <= 2 ? "text-danger" : rating === 3 ? "text-warn" : "text-ok")} aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-muted opacity-40">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
}

function OutreachPanel({ o, draft, clientName }: { o: OutreachContext; draft: Draft; clientName: (id: string | null) => string }) {
  const c = o.creator;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{c.name}</p>
        {c.doNotContact && <Badge tone="danger">Do not contact</Badge>}
        <StatusBadge status={o.stage} />
        {o.compType !== "tbd" && <Badge tone="neutral">{humanize(o.compType)}</Badge>}
      </div>
      <dl className="grid gap-1.5 sm:grid-cols-2">
        {c.instagramHandle && (
          <Row label="Instagram">
            <a href={`https://instagram.com/${c.instagramHandle}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              @{c.instagramHandle}
            </a>{" "}
            <span className="font-normal text-muted">· {formatNumber(c.instagramFollowers)} followers</span>
          </Row>
        )}
        {c.tiktokHandle && (
          <Row label="TikTok">
            <a href={`https://www.tiktok.com/@${c.tiktokHandle}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              @{c.tiktokHandle}
            </a>{" "}
            <span className="font-normal text-muted">· {formatNumber(c.tiktokFollowers)} followers</span>
          </Row>
        )}
        {c.engagementRate != null && <Row label="Engagement">{c.engagementRate.toFixed(1)}%</Row>}
        {(c.city || c.niche) && <Row label="Profile">{[c.niche, c.city].filter(Boolean).join(" · ")}</Row>}
        <Row label="For">{clientName(draft.clientId ?? o.clientId)}</Row>
        {o.contactedAt && <Row label="First contacted">{formatDate(o.contactedAt)}</Row>}
        {draft.kind === "outreach_email" && (
          <>
            <Row label="To">{String(draft.meta.to ?? c.email ?? "—")}</Row>
            <Row label="Subject">{String(draft.meta.subject ?? "—")}</Row>
          </>
        )}
      </dl>
      {o.notes && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{o.notes}</p>}
      {(o.history.length > 0 || o.otherClients.length > 0) && (
        <div className="text-sm">
          <p className="label">Previous outreach</p>
          <ul className="flex flex-col gap-1">
            {o.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <Link href={`/review?draft=${h.id}`} className="hover:underline">{h.title}</Link>
                <span className="text-muted">sent {formatDate(h.sentAt)}</span>
              </li>
            ))}
            {o.otherClients.map((x) => (
              <li key={x.clientId} className="text-muted">
                Also in outreach for {clientName(x.clientId)} ({humanize(x.stage).toLowerCase()})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LeadPanel({ draft }: { draft: Draft }) {
  const m = draft.meta;
  const leadId = typeof m.leadId === "string" ? m.leadId : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Pitch to a potential client</p>
        <Badge tone="info">Lead</Badge>
      </div>
      <dl className="grid gap-1.5">
        {draft.kind === "lead_email" ? (
          <>
            <Row label="To">{String(m.to ?? "—")}</Row>
            <Row label="Subject">{String(m.subject ?? "—")}</Row>
          </>
        ) : (
          <Row label="Send via">{m.channel === "tiktok_dm" ? "TikTok DM" : "Instagram DM"}</Row>
        )}
      </dl>
      {leadId && (
        <Link href={`/leads/${leadId}`} className="text-sm text-accent hover:underline">Open lead</Link>
      )}
    </div>
  );
}

function ContextPanel({ draft, ctx, clientName }: { draft: Draft; ctx: DraftContext; clientName: (id: string | null) => string }) {
  switch (draft.kind) {
    case "review_reply": {
      const r = ctx.review;
      if (!r) return <p className="text-sm text-danger">The Google review this replies to is no longer synced.</p>;
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Stars rating={r.rating} />
            <span className="text-sm font-medium">{r.reviewer ?? "Google user"}</span>
            {r.createTime && <span className="text-xs text-muted">{formatDate(r.createTime)}</span>}
            {r.replyText && draft.status !== "sent" && <Badge tone="warn">Already has a reply</Badge>}
          </div>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm">{r.comment || <span className="text-muted">(Rating only, no text)</span>}</blockquote>
        </div>
      );
    }
    case "outreach_email":
    case "outreach_dm":
      return ctx.outreach ? <OutreachPanel o={ctx.outreach} draft={draft} clientName={clientName} /> : <p className="text-sm text-danger">The outreach record for this draft is missing.</p>;
    case "lead_email":
    case "lead_dm":
      return <LeadPanel draft={draft} />;
    case "instagram_post":
    case "tiktok_post": {
      const p = ctx.post;
      if (!p) return <p className="text-sm text-muted">No calendar post linked.</p>;
      return (
        <div className="flex flex-col gap-3">
          {p.mediaUrls.length ? <MediaStrip urls={p.mediaUrls} /> : <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">No photos or videos attached yet.</p>}
          <dl className="grid gap-1.5 sm:grid-cols-2">
            <Row label="When">{p.scheduledFor ? formatDate(p.scheduledFor, true) : "Not scheduled"}</Row>
            <Row label="Format">{humanize(p.format)}</Row>
            <Row label="Publishing">{p.publishMode === "auto" ? "Auto-publish to Instagram" : "Post manually from the app"}</Row>
            <Row label="Calendar">
              <Link href={`/calendar/${p.id}`} className="text-accent hover:underline">Open post</Link>
            </Row>
          </dl>
        </div>
      );
    }
    case "comment_reply": {
      const text = typeof draft.meta.commentText === "string" ? draft.meta.commentText : null;
      const who = typeof draft.meta.username === "string" ? draft.meta.username : null;
      return text ? (
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm">
          {who && <span className="font-medium">@{who}: </span>}
          {text}
        </blockquote>
      ) : (
        <p className="text-sm text-muted">Original comment text wasn&apos;t included.</p>
      );
    }
    default:
      return null;
  }
}

function manualLinks(draft: Draft, ctx: DraftContext, clientName: (id: string | null) => string) {
  const links: Array<{ href: string; label: string }> = [];
  const c = ctx.outreach?.creator;
  if (draft.kind === "outreach_dm") {
    const ch = draft.meta.channel;
    if (ch === "tiktok_dm" && c?.tiktokHandle) links.push({ href: `https://www.tiktok.com/@${c.tiktokHandle}`, label: "Open TikTok profile" });
    else if (c?.instagramHandle) {
      links.push({ href: `https://ig.me/m/${c.instagramHandle}`, label: "Open Instagram DM" });
      links.push({ href: `https://instagram.com/${c.instagramHandle}`, label: "Open profile" });
    } else if (typeof draft.meta.profileUrl === "string") links.push({ href: draft.meta.profileUrl, label: "Open profile" });
  }
  if (draft.kind === "lead_dm" && typeof draft.meta.profileUrl === "string") {
    // Only links that point at the saved handle's profile (the server builds meta.profileUrl from the lead) —
    // anything else is ignored rather than shown as a button.
    const url = draft.meta.profileUrl;
    const ig = draft.meta.channel === "instagram_dm" ? /^https:\/\/www\.instagram\.com\/([A-Za-z0-9._]+)\/?$/.exec(url)?.[1] : null;
    const tt = draft.meta.channel === "tiktok_dm" ? /^https:\/\/www\.tiktok\.com\/@([A-Za-z0-9._]+)\/?$/.exec(url)?.[1] : null;
    if (ig) {
      links.push({ href: `https://ig.me/m/${ig}`, label: "Open Instagram DM" });
      links.push({ href: `https://www.instagram.com/${ig}/`, label: "Open profile" });
    } else if (tt) links.push({ href: `https://www.tiktok.com/@${tt}`, label: "Open TikTok profile" });
  }
  if (draft.kind === "review_reply") {
    links.push({ href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientName(draft.clientId))}`, label: "Open in Google Maps" });
  }
  if (draft.kind === "comment_reply" && typeof draft.meta.permalink === "string") links.push({ href: draft.meta.permalink, label: "Open post" });
  return links.length ? (
    <>
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
          {l.label} ↗
        </a>
      ))}
    </>
  ) : null;
}

/** What a saved reply's {name} / {business} fill in with for this draft. */
function replyContextFor(draft: Draft, ctx: DraftContext, clientName: (id: string | null) => string): { context: ReplyContext; category?: ReplyCategory } {
  const business = draft.clientId ? clientName(draft.clientId) : undefined;
  switch (draft.kind) {
    case "review_reply":
      return { context: { name: firstName(ctx.review?.reviewer), business }, category: "general" };
    case "outreach_email":
    case "outreach_dm":
      return { context: { name: firstName(ctx.outreach?.creator.name), business }, category: "outreach" };
    case "lead_email":
    case "lead_dm":
      return { context: { name: firstName(ctx.lead?.contactName), business: ctx.lead?.name }, category: "collab" };
    case "comment_reply":
      return { context: { name: typeof draft.meta.username === "string" ? `@${draft.meta.username}` : undefined, business }, category: "general" };
    default:
      return { context: { business } };
  }
}

export function DraftCard({
  draft,
  ctx,
  clientName,
  personName,
  returnTo,
  gmailConnected,
  highlight,
}: {
  draft: Draft;
  ctx: DraftContext;
  clientName: (id: string | null) => string;
  personName: (actor: string | null) => string;
  returnTo: string;
  gmailConnected: boolean;
  highlight?: boolean;
}) {
  const isOutreach = draft.kind === "outreach_email" || draft.kind === "outreach_dm";
  const platform = draft.kind === "outreach_dm" || draft.kind === "lead_dm" ? String(draft.meta.channel ?? "instagram_dm") : KIND_PLATFORM[draft.kind];
  const manualKind = (MANUAL_SEND_KINDS as readonly string[]).includes(draft.kind);
  const mode =
    draft.status === "needs_review" ? "review" : draft.status === "failed" ? "failed" : draft.status === "approved" && manualKind ? "approved" : "readonly";
  const reply = replyContextFor(draft, ctx, clientName);
  const reportAudience = draft.meta.audience === "internal" || ctx.report?.audience === "internal" ? "internal" : "external";
  const hasContext = ["review_reply", "outreach_email", "outreach_dm", "lead_email", "lead_dm", "instagram_post", "tiktok_post", "comment_reply"].includes(draft.kind);

  return (
    <article id={`d-${draft.id}`} className={cx("scroll-mt-20 rounded-xl border bg-surface", highlight ? "border-accent ring-2 ring-accent-soft" : "border-border")}>
      <header className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">{draft.clientId ? clientName(draft.clientId) : draft.kind === "lead_email" || draft.kind === "lead_dm" ? "New lead" : "No business"}</span>
          <PlatformTag platform={platform} />
          <Badge tone="neutral">{kindLabel(draft.kind, draft.meta)}</Badge>
          {draft.kind === "report" && ctx.report?.month && <Badge tone="neutral">{monthLabel(ctx.report.month)}</Badge>}
          {draft.status !== "needs_review" && <StatusBadge status={draft.status} />}
          {isOutreach && asksForPlatformReview(draft.body) && <Badge tone="danger">Asks for a review</Badge>}
          {isOutreach && !hasDisclosureLanguage(draft.body) && <Badge tone="warn">No disclosure</Badge>}
        </div>
        <h3 className="break-words text-base font-semibold">{draft.title}</h3>
        <p className="text-xs text-muted">
          By {personName(draft.createdBy)} · {relativeTime(draft.createdAt)}
          {draft.updatedAt.getTime() - draft.createdAt.getTime() > 60_000 && ` · updated ${relativeTime(draft.updatedAt)}`}
          {draft.reviewedBy && ` · ${draft.status === "rejected" ? "sent back" : "approved"} by ${personName(draft.reviewedBy)}`}
          {draft.sentAt && ` · sent ${formatDate(draft.sentAt, true)}`}
        </p>
      </header>

      <div className={cx("grid gap-4 p-4", hasContext && "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
        {hasContext && (
          <div className="min-w-0 rounded-lg bg-surface-2/50 lg:border-r lg:border-border lg:pr-4">
            <ContextPanel draft={draft} ctx={ctx} clientName={clientName} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-3">
          {draft.status === "failed" && draft.error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Sending failed: {draft.error}
            </p>
          )}
          {draft.status === "rejected" && (
            <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <p className="font-medium">{draft.reviewNote ? `Note: “${draft.reviewNote}”` : "Sent back without a note."}</p>
              <p className="mt-0.5 text-muted">Claude will revise it the next time it checks; the new version shows up under Needs review.</p>
            </div>
          )}
          {mode === "approved" && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              {draft.kind === "outreach_email" || draft.kind === "lead_email"
                ? gmailConnected
                  ? "Approved but not sent. Send it from your email, then click “Mark sent”."
                  : "Gmail isn't connected — send this from your email, then click “Mark sent”."
                : draft.kind === "review_reply"
                  ? "Copy the reply, post it on Google, then click “Mark sent”."
                  : draft.kind === "report"
                    ? reportAudience === "internal"
                      ? "Approved. This one is internal — it's never sent to the owner."
                      : ctx.report?.ownerEmail
                        ? "Approved. Click “Send to owner” to email it — nothing goes out until you do."
                        : "Approved. Copy it and send it to the owner yourself, then click “Mark sent”."
                    : "Copy it, send it from the app, then click “Mark sent”."}
            </p>
          )}
          {draft.status === "approved" && !manualKind && (draft.kind === "instagram_post" || draft.kind === "tiktok_post") && ctx.post && (
            <p className="text-sm text-muted">
              Approved. Track publishing on the{" "}
              <Link href={`/calendar/${ctx.post.id}`} className="text-accent hover:underline">calendar post</Link>.
            </p>
          )}
          <DraftEditor
            id={draft.id}
            kind={draft.kind}
            meta={draft.meta}
            body={draft.body}
            mode={mode}
            returnTo={returnTo}
            mailto={mode === "approved" && (draft.kind === "outreach_email" || draft.kind === "lead_email") && draft.meta.to ? { to: String(draft.meta.to), subject: String(draft.meta.subject ?? "") } : undefined}
            links={mode === "approved" ? manualLinks(draft, ctx, clientName) : undefined}
            postKey={ctx.post ? postReviewKey(ctx.post) : undefined}
            replyContext={reply.context}
            replyCategory={reply.category}
            report={
              draft.kind === "report"
                ? {
                    reportId: typeof draft.meta.reportId === "string" ? draft.meta.reportId : null,
                    clientId: draft.clientId,
                    audience: reportAudience,
                    ownerEmail: ctx.report?.ownerEmail ?? null,
                    month: ctx.report?.month ?? null,
                  }
                : undefined
            }
          />
        </div>
      </div>
    </article>
  );
}
