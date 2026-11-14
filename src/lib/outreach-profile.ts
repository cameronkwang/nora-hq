import type { Client, Creator, Outreach, SendFromKind } from "./schema";

/**
 * Outreach profile, creator check and "already featured" helpers. Pure and dependency-free, so the review queue
 * (server), the send mode (browser) and Claude's tools all read the same rules.
 *
 * - Outreach profile: creator outreach is written AS THE BUSINESS and sent from the business's own account
 *   (clients.sendFrom + sendFromKind), with a standing offer (clients.creatorOffer). Never from Nora's.
 * - Creator check: when a creator's numbers were last read from their public page (creators.statsCheckedAt + statsSource).
 * - Already featured: a creator who already posted about a business (outreach.priorPostUrl, or stage "posted") isn't pitched again.
 */

export const SEND_FROM_LABEL: Record<SendFromKind, string> = { instagram: "Instagram", tiktok: "TikTok", email: "Email", other: "Other" };

export type OutreachProfile = {
  clientId: string;
  business: string;
  sendFromKind: SendFromKind | null;
  sendFrom: string | null;
  creatorOffer: string | null;
};

export function outreachProfileOf(c: Pick<Client, "id" | "name" | "sendFromKind" | "sendFrom" | "creatorOffer">): OutreachProfile {
  const sendFrom = c.sendFrom?.trim() || null;
  return { clientId: c.id, business: c.name, sendFromKind: sendFrom ? (c.sendFromKind ?? "other") : null, sendFrom, creatorOffer: c.creatorOffer?.trim() || null };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What kind of account a typed sender is, when nobody said: an address is email, a tiktok.com link is TikTok, an @handle is Instagram. */
export function guessSendFromKind(raw: string): SendFromKind {
  const s = raw.trim();
  if (EMAIL.test(s)) return "email";
  if (/tiktok\.com/i.test(s)) return "tiktok";
  if (/instagram\.com/i.test(s) || /^@[A-Za-z0-9._]{1,30}$/.test(s)) return "instagram";
  return "other";
}

/** "@craboclock (Instagram)", "hello@example.com (Email)", or null when no sender is saved. */
export function senderWithKind(p: Pick<OutreachProfile, "sendFrom" | "sendFromKind">): string | null {
  if (!p.sendFrom) return null;
  return p.sendFromKind && p.sendFromKind !== "other" ? `${p.sendFrom} (${SEND_FROM_LABEL[p.sendFromKind]})` : p.sendFrom;
}

export type SendChannel = "instagram_dm" | "tiktok_dm" | "email";
const CHANNEL_KIND: Record<SendChannel, SendFromKind> = { instagram_dm: "instagram", tiktok_dm: "tiktok", email: "email" };
const CHANNEL_NAME: Record<SendChannel, string> = { instagram_dm: "an Instagram DM", tiktok_dm: "a TikTok DM", email: "an email" };
const CHANNEL_ACCOUNT: Record<SendChannel, string> = { instagram_dm: "Instagram", tiktok_dm: "TikTok", email: "email" };

/** The channel an outreach draft goes out on. */
export function draftChannel(kind: string, meta: Record<string, unknown>): SendChannel {
  if (kind === "outreach_email") return "email";
  return meta.channel === "tiktok_dm" ? "tiktok_dm" : "instagram_dm";
}

/**
 * A plain-words warning when a message's channel isn't the kind of account saved as the sender
 * (a TikTok DM for a business whose saved sender is its Instagram). Null when they match, or no sender is saved.
 */
export function senderMismatch(p: OutreachProfile, channel: SendChannel): string | null {
  if (!p.sendFrom || !p.sendFromKind || p.sendFromKind === "other" || p.sendFromKind === CHANNEL_KIND[channel]) return null;
  return `This is ${CHANNEL_NAME[channel]}, but ${p.business}'s saved sender is ${senderWithKind(p)}. Send it from ${p.business}'s own ${CHANNEL_ACCOUNT[channel]}.`;
}

/**
 * Where a person sends a message from, in a few words: the saved sender when it fits the channel
 * ("@craboclock"), else the business's own account on that channel ("Crab O Clock's own TikTok").
 */
export function sendFromText(p: OutreachProfile, channel: SendChannel): string {
  if (!p.sendFrom) return `${p.business}'s own ${CHANNEL_ACCOUNT[channel]}`;
  return senderMismatch(p, channel) ? `${p.business}'s own ${CHANNEL_ACCOUNT[channel]}` : p.sendFrom;
}

/**
 * What approving an outreach email does. The connected Gmail inbox only sends it automatically when that inbox IS the
 * business's saved sender, or when the business has no sender saved yet (how it worked before outreach profiles).
 * Otherwise a person sends it by hand from the business's account and marks it sent.
 */
export function emailSendPlan(p: Pick<OutreachProfile, "sendFrom" | "sendFromKind"> | null | undefined, gmailAddress: string | null | undefined): { auto: boolean; from: string | null } {
  const gmail = gmailAddress?.trim().toLowerCase() || null;
  const saved = p?.sendFrom?.trim() || null;
  if (!saved) return { auto: !!gmail, from: gmail };
  const isGmail = p?.sendFromKind === "email" && !!gmail && saved.toLowerCase() === gmail;
  return { auto: isGmail, from: saved };
}

/** True when a message reads as if Nora is the one writing ("I'm Nora", "@noraeatsgood"). Outreach is written as the business. */
export function readsAsNora(text: string): boolean {
  return /\b(i['’]?m|i am|this is|it['’]?s|my name is)\s+nora\b|noraeatsgood|\bnora (here|from)\b/i.test(text);
}

/* ───────────────────────── Creator check ───────────────────────── */

/** Numbers older than this (or never checked) get a warning before a pitch goes out. */
export const STATS_STALE_DAYS = 30;

export type StatsCheck = { state: "never" | "stale" | "fresh"; days: number | null; label: string };

/** When a creator's follower numbers were last read from their public page: "never checked", "checked today", "checked 3d ago". */
export function statsCheck(c: Pick<Creator, "statsCheckedAt">, now: Date = new Date()): StatsCheck {
  const at = c.statsCheckedAt ? new Date(c.statsCheckedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return { state: "never", days: null, label: "never checked" };
  const days = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
  return { state: days > STATS_STALE_DAYS ? "stale" : "fresh", days, label: days === 0 ? "checked today" : `checked ${days}d ago` };
}

/** A public web address (http/https, a real host, no login in it), tidied. Null when it isn't one. */
export function publicUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 600 || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** "tiktok.com/@jess" from a full URL: short enough for one line. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const text = `${u.hostname.replace(/^www\./, "")}${path}`;
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
  } catch {
    return url;
  }
}

/* ───────────────────────── Already featured ───────────────────────── */

export type AlreadyPosted = {
  /** The post, when we have its link. */
  url: string | null;
  /** true = they'd posted before we ever reached out (found during research); false = the post came out of our outreach. */
  prior: boolean;
  foundAt: Date | null;
};

/** A creator who already posted about this business: a prior post was recorded, or the outreach reached "posted". */
export function alreadyPosted(o: Pick<Outreach, "stage" | "priorPostUrl" | "priorPostFoundAt" | "postUrl">): AlreadyPosted | null {
  if (o.priorPostUrl) return { url: o.priorPostUrl, prior: true, foundAt: o.priorPostFoundAt ?? null };
  if (o.stage === "posted") return { url: o.postUrl ?? null, prior: false, foundAt: null };
  return null;
}
