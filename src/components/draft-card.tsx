import Link from "next/link";
import type { Draft } from "@/lib/schema";
import type { DraftContext, OutreachContext } from "@/app/(app)/review/queries";
import { formatDate, monthLabel, relativeTime } from "@/lib/dates";
import { PlatformTag, Status, StatusBadge, Tag, buttonClass, cx, formatNumber, humanize } from "./ui";
import { DraftEditor } from "./draft-editor";
import { postReviewKey } from "@/lib/post-key";
import { MediaStrip } from "./calendar-media";
import { MANUAL_SEND_KINDS, asksForPlatformReview, hasDisclosureLanguage, kindLabel } from "./draft-checks";
import { firstName, type ReplyCategory, type ReplyContext } from "./reply-fill";
import { alreadyPosted, draftChannel, readsAsNora, sendFromText } from "@/lib/outreach-profile";
import { CreatorCheckLine, SenderChip } from "./outreach-sender";
import { PROFILE_COPY_LINK, PROFILE_COPY_PLATFORM, PROFILE_COPY_WHERE, profileCopySurface } from "@/lib/profile-copy";
import { PROFILE_COPY_LIMITS } from "@/lib/schema";

const KIND_PLATFORM: Record<string, string> = {
  instagram_post: "instagram",
  tiktok_post: "tiktok",
  review_reply: "google",
  outreach_email: "email",
  lead_email: "email",
  comment_reply: "instagram",
};

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="meta">No rating</span>;
  // Ink stars: the count says it, not a colour.
  return (
    <span className="text-sm tracking-tight" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-faint">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function OutreachPanel({ o, draft, clientName }: { o: OutreachContext; draft: Draft; clientName: (id: string | null) => string }) {
  const c = o.creator;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-semibold">{c.name}</p>
        {c.doNotContact && <Status tone="danger" small>Do not contact</Status>}
        <StatusBadge status={o.stage} />
        {o.compType !== "tbd" && <Tag bare>{humanize(o.compType)}</Tag>}
      </div>
      {/* Creator check: their numbers, when they were last read from the public page, and whether they already posted about this business. */}
      <CreatorCheckLine creator={c} channel={draftChannel(draft.kind, draft.meta)} posted={alreadyPosted(o)} business={clientName(draft.clientId ?? o.clientId)} />
      <dl className="draft-kv">
        {c.instagramHandle && (
          <Row label="Instagram">
            <a href={`https://instagram.com/${c.instagramHandle}`} target="_blank" rel="noreferrer" className="link">
              @{c.instagramHandle}
            </a>
            {c.instagramFollowers != null && <span className="font-normal text-muted"> · {formatNumber(c.instagramFollowers)} followers</span>}
          </Row>
        )}
        {c.tiktokHandle && (
          <Row label="TikTok">
            <a href={`https://www.tiktok.com/@${c.tiktokHandle}`} target="_blank" rel="noreferrer" className="link">
              @{c.tiktokHandle}
            </a>
            {c.tiktokFollowers != null && <span className="font-normal text-muted"> · {formatNumber(c.tiktokFollowers)} followers</span>}
          </Row>
        )}
        {c.engagementRate != null && <Row label="Engagement">{c.engagementRate.toFixed(1)}%</Row>}
        {(c.city || c.niche) && <Row label="Profile">{[c.niche, c.city].filter(Boolean).join(" · ")}</Row>}
        <Row label="For">{clientName(draft.clientId ?? o.clientId)}</Row>
        {o.contactedAt && <Row label="First contacted">{formatDate(o.contactedAt)}</Row>}
        {draft.kind === "outreach_email" && (
          <>
            <Row label="To">{String(draft.meta.to ?? c.email ?? "Not set")}</Row>
            <Row label="Subject">{String(draft.meta.subject ?? "(no subject)")}</Row>
          </>
        )}
      </dl>
      {o.notes && <p className="ask-quote meta whitespace-pre-wrap break-words">{o.notes}</p>}
      {(o.history.length > 0 || o.otherClients.length > 0) && (
        <div className="text-sm">
          <p className="eyebrow mb-1">Previous outreach</p>
          <ul className="flex flex-col gap-1">
            {o.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <Link href={`/review?draft=${h.id}`} className="link">{h.title}</Link>
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
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-semibold">Pitch to a potential client</p>
        <Status tone="info" small>Lead</Status>
      </div>
      <dl className="draft-kv">
        {draft.kind === "lead_email" ? (
          <>
            <Row label="To">{String(m.to ?? "Not set")}</Row>
            <Row label="Subject">{String(m.subject ?? "(no subject)")}</Row>
          </>
        ) : (
          <Row label="Send via">{m.channel === "tiktok_dm" ? "TikTok DM" : "Instagram DM"}</Row>
        )}
      </dl>
      {leadId && (
        <Link href={`/leads/${leadId}`} className="link w-fit text-sm">Open lead</Link>
      )}
    </div>
  );
}

function ContextPanel({ draft, ctx, clientName }: { draft: Draft; ctx: DraftContext; clientName: (id: string | null) => string }) {
  switch (draft.kind) {
    case "review_reply": {
      const r = ctx.review;
      if (!r) return <Status tone="danger" className="whitespace-normal">The Google review this replies to is no longer synced.</Status>;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Stars rating={r.rating} />
            <span className="font-medium">{r.reviewer ?? "Google user"}</span>
            {r.createTime && <span className="meta">{formatDate(r.createTime)}</span>}
            {r.replyText && draft.status !== "sent" && <Status tone="warn" small>Already has a reply</Status>}
          </div>
          <blockquote className="ask-quote whitespace-pre-wrap break-words">{r.comment || <span className="text-muted">(Rating only, no text)</span>}</blockquote>
        </div>
      );
    }
    case "outreach_email":
    case "outreach_dm":
      return ctx.outreach ? <OutreachPanel o={ctx.outreach} draft={draft} clientName={clientName} /> : <Status tone="danger" className="whitespace-normal">The outreach record for this draft is missing.</Status>;
    case "lead_email":
    case "lead_dm":
      return <LeadPanel draft={draft} />;
    case "instagram_post":
    case "tiktok_post": {
      const p = ctx.post;
      if (!p) return <p className="meta">No calendar post linked.</p>;
      return (
        <div className="flex flex-col gap-3">
          {p.mediaUrls.length ? <MediaStrip urls={p.mediaUrls} /> : <Status tone="warn" className="whitespace-normal">No photos or videos attached yet.</Status>}
          <dl className="draft-kv">
            <Row label="When">{p.scheduledFor ? formatDate(p.scheduledFor, true) : "Not scheduled"}</Row>
            <Row label="Format">{humanize(p.format)}</Row>
            <Row label="Publishing">{p.publishMode === "auto" ? "Auto-publish to Instagram" : "Post manually from the app"}</Row>
            <Row label="Calendar">
              <Link href={`/calendar/${p.id}`} className="link">Open post</Link>
            </Row>
          </dl>
        </div>
      );
    }
    case "comment_reply": {
      const text = typeof draft.meta.commentText === "string" ? draft.meta.commentText : null;
      const who = typeof draft.meta.username === "string" ? draft.meta.username : null;
      return text ? (
        <blockquote className="ask-quote whitespace-pre-wrap break-words">
          {who && <span className="font-medium">@{who}: </span>}
          {text}
        </blockquote>
      ) : (
        <p className="meta">Original comment text wasn&apos;t included.</p>
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
  if (draft.kind === "profile_copy") {
    // Where the approved text gets pasted (the business's own account has to be signed in there).
    const surface = profileCopySurface(draft.meta);
    const link = surface ? PROFILE_COPY_LINK[surface] : undefined;
    if (link) links.push(link);
  }
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
  gmailAddress,
  highlight,
}: {
  draft: Draft;
  ctx: DraftContext;
  clientName: (id: string | null) => string;
  personName: (actor: string | null) => string;
  returnTo: string;
  gmailConnected: boolean;
  /** The connected Gmail outreach inbox (outreach emails are only auto-sent when it is the business's saved sender). */
  gmailAddress?: string | null;
  highlight?: boolean;
}) {
  const isOutreach = draft.kind === "outreach_email" || draft.kind === "outreach_dm";
  // Profile text (a bio / Google description): where it gets pasted, and that platform's length limit.
  const profileSurface = draft.kind === "profile_copy" ? profileCopySurface(draft.meta) : null;
  const platform =
    draft.kind === "outreach_dm" || draft.kind === "lead_dm" ? String(draft.meta.channel ?? "instagram_dm") : profileSurface ? PROFILE_COPY_PLATFORM[profileSurface] : KIND_PLATFORM[draft.kind];
  const manualKind = (MANUAL_SEND_KINDS as readonly string[]).includes(draft.kind);
  const mode =
    draft.status === "needs_review" ? "review" : draft.status === "failed" ? "failed" : draft.status === "approved" && manualKind ? "approved" : "readonly";
  const reply = replyContextFor(draft, ctx, clientName);
  const reportAudience = draft.meta.audience === "internal" || ctx.report?.audience === "internal" ? "internal" : "external";
  const hasContext = ["review_reply", "outreach_email", "outreach_dm", "lead_email", "lead_dm", "instagram_post", "tiktok_post", "comment_reply"].includes(draft.kind);
  // Creator outreach is written as the business and sent from its own account (the outreach profile), never Nora's.
  const profile = isOutreach ? (ctx.profile ?? null) : null;
  const postedAlready = isOutreach && ctx.outreach ? alreadyPosted(ctx.outreach) : null;

  // One accent action per screen: the main button is filled only when this draft has the page to itself
  // (opened from a link). In a list the queue fills it for the card you are on; everywhere else it is outlined.
  const solo = !!highlight;

  return (
    <article id={`d-${draft.id}`} className="draft-card">
      <header>
        <h3 className="title break-words">{draft.title}</h3>
        <div className="draft-facts">
          <span className="font-medium">{draft.clientId ? clientName(draft.clientId) : draft.kind === "lead_email" || draft.kind === "lead_dm" ? "New lead" : "No business"}</span>
          <PlatformTag platform={platform} />
          <Tag bare>{kindLabel(draft.kind, draft.meta)}</Tag>
          {draft.kind === "report" && ctx.report?.month && <Tag bare>{monthLabel(ctx.report.month)}</Tag>}
          {draft.status !== "needs_review" && <StatusBadge status={draft.status} />}
          {isOutreach && asksForPlatformReview(draft.body) && <Status tone="danger" small>Asks for a review</Status>}
          {isOutreach && !hasDisclosureLanguage(draft.body) && <Status tone="warn" small>No disclosure</Status>}
          {isOutreach && draft.status !== "sent" && postedAlready && <Status tone="danger" small>Already featured</Status>}
          {isOutreach && draft.status !== "sent" && readsAsNora(draft.body) && <Status tone="warn" small>Reads as Nora</Status>}
        </div>
        <p className="meta mt-1">
          By {personName(draft.createdBy)} · {relativeTime(draft.createdAt)}
          {draft.updatedAt.getTime() - draft.createdAt.getTime() > 60_000 && ` · updated ${relativeTime(draft.updatedAt)}`}
          {draft.reviewedBy && ` · ${draft.status === "rejected" ? "sent back" : "approved"} by ${personName(draft.reviewedBy)}`}
          {draft.sentAt && ` · sent ${formatDate(draft.sentAt, true)}`}
        </p>
      </header>

      {/* Outreach: which account it goes out from (the business's own, never Nora's) and the standing offer. */}
      {profile && draft.status !== "sent" && (
        <div className="mt-3">
          <SenderChip profile={profile} channel={draftChannel(draft.kind, draft.meta)} gmailAddress={gmailAddress} pending={draft.status === "needs_review" || draft.status === "failed"} />
        </div>
      )}

      <div className={cx("draft-grid", hasContext && "has-context")}>
        {hasContext && (
          <div className="min-w-0">
            <ContextPanel draft={draft} ctx={ctx} clientName={clientName} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-3">
          {profileSurface && draft.status === "needs_review" && (
            <p className="meta">
              Goes in <span className="font-medium text-text">{PROFILE_COPY_WHERE[profileSurface]}</span> · {PROFILE_COPY_LIMITS[profileSurface]} characters max. Nothing is changed on the profile until you paste it in.
            </p>
          )}
          {draft.status === "failed" && draft.error && (
            <p role="alert" className="notice">
              <Status tone="danger" className="whitespace-normal">Sending failed: {draft.error}</Status>
            </p>
          )}
          {draft.status === "rejected" && (
            <div className="ask-quote">
              <p className="font-medium">{draft.reviewNote ? `Note: “${draft.reviewNote}”` : "Sent back without a note."}</p>
              <p className="meta mt-0.5">Claude will revise it the next time it checks; the new version shows up under Needs review.</p>
            </div>
          )}
          {mode === "approved" && (
            <p className="notice">
              <Status tone="warn" className="whitespace-normal">
                {profile?.sendFrom
                  ? `Copy it, send it from ${sendFromText(profile, draftChannel(draft.kind, draft.meta))} (not Nora's), then click “Mark sent”.`
                  : draft.kind === "outreach_email" || draft.kind === "lead_email"
                    ? gmailConnected
                      ? "Approved but not sent. Send it from your email, then click “Mark sent”."
                      : "Gmail isn't connected. Send this from your email, then click “Mark sent”."
                    : draft.kind === "profile_copy"
                      ? `Copy it, paste it into ${profileSurface ? PROFILE_COPY_WHERE[profileSurface] : "the profile"}, then click “Mark done”.`
                      : draft.kind === "review_reply"
                        ? "Copy the reply, post it on Google, then click “Mark sent”."
                        : draft.kind === "report"
                          ? reportAudience === "internal"
                            ? "Approved. This one is internal: it's never sent to the owner."
                            : ctx.report?.ownerEmail
                              ? "Approved. Click “Send to owner” to email it. Nothing goes out until you do."
                              : "Approved. Copy it and send it to the owner yourself, then click “Mark sent”."
                          : "Copy it, send it from the app, then click “Mark sent”."}
              </Status>
            </p>
          )}
          {draft.status === "approved" && !manualKind && (draft.kind === "instagram_post" || draft.kind === "tiktok_post") && ctx.post && (
            <p className="meta">
              Approved. Track publishing on the{" "}
              <Link href={`/calendar/${ctx.post.id}`} className="link">calendar post</Link>.
            </p>
          )}
          <DraftEditor
            id={draft.id}
            kind={draft.kind}
            meta={draft.meta}
            body={draft.body}
            mode={mode}
            solo={solo}
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
