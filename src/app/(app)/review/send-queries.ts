import "server-only";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { SendFromKind } from "@/lib/schema";
import { alreadyPosted, draftChannel, outreachProfileOf, senderMismatch, statsCheck, type SendChannel } from "@/lib/outreach-profile";
import { formatNumber } from "@/components/ui";

/**
 * "Ready to send" (send mode on /review): approved creator-outreach messages, grouped by the account they go out
 * from (the business's outreach profile), so a person can work through them one at a time on a phone.
 * Everything here is plain data for the client component: no dates, no functions.
 */

export type SendItem = {
  id: string;
  title: string;
  body: string;
  channel: SendChannel;
  channelLabel: string;
  creatorName: string;
  /** "@jess" on the channel's platform, or the email address. */
  to: string | null;
  /** "10.5K TikTok" */
  followers: string | null;
  check: { label: string; warn: boolean };
  /** They already posted about this business (link when we have it). */
  posted: { url: string | null } | null;
  /** Do-not-contact or declined: "Sent" would be refused, so say why instead. */
  blocked: string | null;
  /** DM: opens the conversation (Instagram) or the profile (TikTok). */
  open: { href: string; label: string } | null;
  profile: { href: string; label: string } | null;
  /** Email: recipient + subject for a mailto: link. */
  mailto: { to: string; subject: string } | null;
  /** The message's channel isn't the kind of account saved as the sender. */
  mismatch: string | null;
};

export type SendGroup = {
  key: string;
  clientId: string;
  business: string;
  sendFrom: string | null;
  sendFromKind: SendFromKind | null;
  offer: string | null;
  items: SendItem[];
};

const SEND_KINDS = ["outreach_dm", "outreach_email"] as const;
const CHANNEL_LABEL: Record<SendChannel, string> = { instagram_dm: "Instagram DM", tiktok_dm: "TikTok DM", email: "Email" };
const CHANNEL_ORDER: Record<SendChannel, number> = { instagram_dm: 0, tiktok_dm: 1, email: 2 };

function where(f: { client?: string }): SQL[] {
  return [eq(schema.drafts.status, "approved"), inArray(schema.drafts.kind, [...SEND_KINDS]), ...(f.client ? [eq(schema.drafts.clientId, f.client)] : [])];
}

/** How many approved outreach messages are waiting to be sent by hand. */
export async function readyToSendCount(f: { client?: string } = {}): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.drafts).where(and(...where(f)));
  return row?.n ?? 0;
}

function followersText(c: schema.Creator, channel: SendChannel): string | null {
  const ig = c.instagramFollowers != null ? `${formatNumber(c.instagramFollowers)} IG` : null;
  const tt = c.tiktokFollowers != null ? `${formatNumber(c.tiktokFollowers)} TikTok` : null;
  if (channel === "tiktok_dm") return tt ?? ig;
  if (channel === "instagram_dm") return ig ?? tt;
  return [ig, tt].filter(Boolean).join(" · ") || null;
}

/** Approved outreach messages grouped by business (= by sender account), Instagram DMs first so you stay in one app. */
export async function listReadyToSend(f: { client?: string } = {}): Promise<SendGroup[]> {
  const db = await getDb();
  const drafts = await db.select().from(schema.drafts).where(and(...where(f))).orderBy(asc(schema.drafts.reviewedAt), asc(schema.drafts.createdAt)).limit(200);
  if (!drafts.length) return [];

  const outreachIds = [...new Set(drafts.map((d) => String(d.meta.outreachId ?? "")).filter(Boolean))];
  const rows = outreachIds.length
    ? await db.select({ o: schema.outreach, c: schema.creators }).from(schema.outreach)
        .innerJoin(schema.creators, eq(schema.outreach.creatorId, schema.creators.id))
        .where(inArray(schema.outreach.id, outreachIds))
    : [];
  const byOutreach = new Map(rows.map((r) => [r.o.id, r]));
  const clientIds = [...new Set(drafts.map((d) => d.clientId ?? byOutreach.get(String(d.meta.outreachId ?? ""))?.o.clientId).filter((x): x is string => !!x))];
  const clients = clientIds.length ? await db.select().from(schema.clients).where(inArray(schema.clients.id, clientIds)) : [];
  const byClient = new Map(clients.map((c) => [c.id, c]));

  const groups = new Map<string, SendGroup>();
  for (const d of drafts) {
    const row = byOutreach.get(String(d.meta.outreachId ?? ""));
    const client = byClient.get(d.clientId ?? row?.o.clientId ?? "");
    if (!row || !client) continue; // a draft whose outreach record is gone stays on the normal list, where the card explains it
    const { o, c } = row;
    const profile = outreachProfileOf(client);
    const channel = draftChannel(d.kind, d.meta);
    const check = statsCheck(c);
    const posted = alreadyPosted(o);
    const emailTo = channel === "email" ? String(d.meta.to ?? c.email ?? "").trim() : "";
    const ig = c.instagramHandle ? encodeURIComponent(c.instagramHandle) : null;
    const tt = c.tiktokHandle ? encodeURIComponent(c.tiktokHandle) : null;

    const item: SendItem = {
      id: d.id,
      title: d.title,
      body: d.body,
      channel,
      channelLabel: CHANNEL_LABEL[channel],
      creatorName: c.name,
      to: channel === "email" ? emailTo || null : channel === "tiktok_dm" ? (c.tiktokHandle ? `@${c.tiktokHandle}` : null) : c.instagramHandle ? `@${c.instagramHandle}` : null,
      followers: followersText(c, channel),
      check: { label: check.label, warn: check.state !== "fresh" },
      posted: posted ? { url: posted.url } : null,
      blocked: c.doNotContact ? `${c.name} is marked do-not-contact. Don't send this.` : o.stage === "declined" ? `${c.name} declined. Don't send this.` : null,
      // Short labels: two buttons share one row on a phone (the card's header already says which app).
      open: channel === "instagram_dm" && ig ? { href: `https://ig.me/m/${ig}`, label: "Open DM" } : channel === "tiktok_dm" && tt ? { href: `https://www.tiktok.com/@${tt}`, label: "Open TikTok" } : null,
      profile: channel === "instagram_dm" && ig ? { href: `https://www.instagram.com/${ig}/`, label: "Profile" } : null,
      mailto: channel === "email" && emailTo ? { to: emailTo, subject: String(d.meta.subject ?? "") } : null,
      mismatch: senderMismatch(profile, channel),
    };

    const key = client.id;
    const g = groups.get(key) ?? { key, clientId: client.id, business: client.name, sendFrom: profile.sendFrom, sendFromKind: profile.sendFromKind, offer: profile.creatorOffer, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.items.sort((a, b) => CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel]);
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.business.localeCompare(b.business));
}
