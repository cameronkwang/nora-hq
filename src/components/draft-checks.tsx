/**
 * Pure helpers shared by the review queue (server) and the draft editor (client).
 * No "use client" / no server-only imports, so both sides can call them.
 */

export const KIND_LABELS: Record<string, string> = {
  instagram_post: "Instagram post",
  tiktok_post: "TikTok post",
  review_reply: "Review reply",
  outreach_email: "Outreach email",
  outreach_dm: "Outreach DM",
  lead_email: "Pitch email",
  lead_dm: "Pitch DM",
  comment_reply: "Comment reply",
  report: "Report",
  other: "Other",
};

/** Kinds that end up "approved" and wait for a person to send them (by hand, or "Send to owner" for reports). */
export const MANUAL_SEND_KINDS = ["review_reply", "outreach_email", "outreach_dm", "lead_email", "lead_dm", "comment_reply", "report"] as const;

/** The only kind that may be approved in bulk. Outreach, pitches, posts and reports always get one-by-one review. */
export const BULK_APPROVE_KINDS = ["review_reply"] as const;

export function kindLabel(kind: string, meta?: Record<string, unknown>) {
  if (kind === "outreach_dm" || kind === "lead_dm") {
    const base = kind === "lead_dm" ? "Pitch DM" : "Outreach DM";
    const ch = meta?.channel;
    if (ch === "instagram_dm") return `${base} (Instagram)`;
    if (ch === "tiktok_dm") return `${base} (TikTok)`;
  }
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

/** Character limits we warn about. hard = approving would fail on the platform, so Approve is disabled. */
export function textLimit(kind: string, meta?: Record<string, unknown>): { max: number; label: string; hard: boolean } | null {
  switch (kind) {
    case "instagram_post":
      return { max: 2200, label: "Instagram caption", hard: true };
    case "tiktok_post":
      return { max: 4000, label: "TikTok caption", hard: true };
    case "review_reply":
      return { max: 4096, label: "Google reply", hard: true };
    case "comment_reply":
      return { max: 2200, label: "Instagram comment", hard: true };
    case "outreach_dm":
    case "lead_dm":
      return meta?.channel === "instagram_dm" ? { max: 1000, label: "Instagram DM", hard: false } : null;
    default:
      return null;
  }
}

export function countHashtags(text: string) {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

const DISCLOSURE_RE = /(gift(ed)?|#ad\b|\bad\b|#sponsored|sponsor|disclos|partnership|#partner|paid|complimentary|on the house|comped|in exchange)/i;

/** True if an outreach message mentions the deal in a way that makes disclosure expectations clear. */
export function hasDisclosureLanguage(text: string) {
  return DISCLOSURE_RE.test(text);
}

/** True if a sentence asks for a Google/Yelp review or rating — incentivized reviews are illegal (FTC rule, 2024). */
export function asksForPlatformReview(text: string) {
  return text
    .split(/(?<=[.!?\n])/)
    .some((s) => /\b(google|yelp)\b/i.test(s) && /\b(review|reviews|rating|rate|stars?)\b/i.test(s));
}

export function draftWarnings(kind: string, body: string, meta?: Record<string, unknown>) {
  const out: Array<{ tone: "warn" | "danger"; text: string }> = [];
  const lim = textLimit(kind, meta);
  if (lim && body.length > lim.max)
    out.push({ tone: lim.hard ? "danger" : "warn", text: `${lim.label} is ${(body.length - lim.max).toLocaleString("en-US")} characters over the ${lim.max.toLocaleString("en-US")} limit.` });
  if (kind === "instagram_post") {
    const n = countHashtags(body);
    if (n > 30) out.push({ tone: "danger", text: `${n} hashtags — Instagram allows 30 at most and may reject the post.` });
  }
  if (kind === "outreach_email" || kind === "outreach_dm") {
    if (asksForPlatformReview(body))
      out.push({ tone: "danger", text: "This asks for a Google or Yelp review in exchange for a visit. That's an illegal incentivized review — remove it before sending." });
    if (!hasDisclosureLanguage(body))
      out.push({ tone: "warn", text: "No disclosure language. Mention it's gifted/a partnership and that posts need #ad or a paid-partnership label." });
  }
  if ((kind === "lead_email" || kind === "lead_dm") && /\b(buy|purchase|paid|fake)\b[^.!?\n]*\breviews?\b/i.test(body))
    out.push({ tone: "danger", text: "This mentions buying or faking reviews. Remove it before sending." });
  return out;
}
