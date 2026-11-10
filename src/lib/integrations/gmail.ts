import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Connection } from "../schema";
import { notConfigured, type IntegrationResult } from "./types";
import { HttpError, errorText, fetchJson } from "./http";
import { findConnection, ops } from "./connections";
import { friendlyGoogleError, googleAccessToken, googleOAuthConfigured } from "./google-auth";

/**
 * Gmail outreach inbox: a shared connection (provider "gmail", clientId null). Sends approved outreach emails
 * and watches their threads for replies. Env: GOOGLE_CLIENT_ID/SECRET, optional OUTREACH_FOOTER, OUTREACH_FROM_NAME.
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const OPT_OUT_LINE = "Not interested? Just reply 'stop' and we won't email again.";

export function gmailConfigured(): boolean {
  return googleOAuthConfigured();
}

/** Mailbox address for a just-authorized token (used to label the connection). */
export async function gmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  return fetchJson<{ emailAddress: string }>(`${API}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
}

type Auth = { conn: Connection; token: string; address: string };

async function auth(): Promise<Auth | IntegrationResult> {
  if (!gmailConfigured()) return notConfigured("Gmail");
  const conn = await findConnection("gmail", null);
  if (!conn) return notConfigured("Gmail");
  const t = await googleAccessToken(conn);
  if (!t.ok) return { ok: false, error: t.error };
  return { conn, token: t.token, address: (conn.externalId ?? conn.label).toLowerCase() };
}
const isAuth = (a: Auth | IntegrationResult): a is Auth => "token" in a;

/* ───────────── Message building ───────────── */

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);
const encodeWord = (s: string) => (isAscii(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

function senderName(conn: Connection): string {
  return process.env.OUTREACH_FROM_NAME?.trim() || conn.label.split("@")[0];
}

/** CAN-SPAM footer: who it's from + how to opt out. OUTREACH_FOOTER overrides it ({sender} is replaced). */
export function outreachFooter(sender: string): string {
  const custom = process.env.OUTREACH_FOOTER?.trim();
  if (custom) return custom.replace(/\\n/g, "\n").replace(/\{sender\}/g, sender);
  return `--\n${sender}\n${OPT_OUT_LINE}`;
}

function withFooter(body: string, sender: string): string {
  const footer = outreachFooter(sender);
  const text = body.replace(/\r\n/g, "\n").trimEnd();
  if (text.includes(footer.trim()) || /reply ['"‘’“”]?stop['"‘’“”]?/i.test(text)) return text;
  return `${text}\n\n${footer}`;
}

function buildRaw(h: { from: string; to: string; subject: string; inReplyTo?: string | null; references?: string | null }, body: string): string {
  const b64 = Buffer.from(body.replace(/\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  const lines = [
    `From: ${h.from}`,
    `To: ${h.to}`,
    `Subject: ${encodeWord(h.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (h.inReplyTo) lines.push(`In-Reply-To: ${h.inReplyTo}`);
  if (h.references) lines.push(`References: ${h.references}`);
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n${b64}`, "utf8").toString("base64url");
}

type ThreadMeta = {
  id: string;
  messages?: Array<{ id: string; internalDate?: string; snippet?: string; labelIds?: string[]; payload?: { headers?: Array<{ name: string; value: string }> } }>;
};
const header = (m: NonNullable<ThreadMeta["messages"]>[number], name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

async function getThread(token: string, threadId: string, headers: string[]): Promise<ThreadMeta> {
  const u = new URL(`${API}/threads/${encodeURIComponent(threadId)}`);
  u.searchParams.set("format", "metadata");
  for (const h of headers) u.searchParams.append("metadataHeaders", h);
  return fetchJson<ThreadMeta>(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
}

/* ───────────── Send ───────────── */

export async function sendOutreachEmail(args: { to: string; subject: string; body: string; threadId?: string | null }): Promise<IntegrationResult> {
  const a = await auth();
  if (!isAuth(a)) return a;
  const to = oneLine(args.to);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) return { ok: false, error: `“${to}” doesn't look like an email address.` };
  let subject = oneLine(args.subject) || "(no subject)";
  const sender = senderName(a.conn);
  const from = `${encodeWord(oneLine(sender).replace(/"/g, ""))} <${a.address}>`;

  let threadId: string | undefined = args.threadId || undefined;
  let inReplyTo: string | null = null;
  let references: string | null = null;
  if (threadId) {
    try {
      const t = await getThread(a.token, threadId, ["Message-ID", "References", "Subject"]);
      const msgs = t.messages ?? [];
      const last = msgs[msgs.length - 1];
      const first = msgs[0];
      if (last) {
        inReplyTo = header(last, "Message-ID");
        const prevRefs = header(last, "References");
        references = [prevRefs, inReplyTo].filter(Boolean).join(" ") || null;
      }
      // Gmail only threads a message when the subjects match.
      const original = first ? header(first, "Subject") : null;
      if (original?.trim()) subject = `Re: ${oneLine(original).replace(/^((re|fwd?|aw)\s*:\s*)+/i, "")}`;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) threadId = undefined; // thread deleted: start a new one
      else return { ok: false, error: friendlyGoogleError(e, "Gmail") };
    }
  }

  const raw = buildRaw({ from, to, subject, inReplyTo, references }, withFooter(args.body, sender));
  try {
    const r = await fetchJson<{ id: string; threadId: string }>(`${API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    });
    return { ok: true, externalId: r.id, threadId: r.threadId };
  } catch (e) {
    const msg = friendlyGoogleError(e, "Gmail");
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      try {
        const { setConnectionStatus } = await ops();
        await setConnectionStatus(a.conn.id, "error", msg);
      } catch {
        /* bookkeeping only */
      }
    }
    return { ok: false, error: msg };
  }
}

/* ───────────── Reply detection ───────────── */

const addressOf = (from: string | null) => (from?.match(/<([^>]+)>/)?.[1] ?? from ?? "").trim().toLowerCase();

export type ReplyCheckResult = { ok: boolean; checked: number; replied: number; optedOut: number; errors: string[]; notConfigured?: boolean };

/**
 * For outreach in "contacted"/"followed_up" with a Gmail thread: if someone other than us wrote in the thread
 * after we first contacted them, move the outreach to "replied". A reply that starts with "stop" marks the
 * creator do-not-contact and the outreach "declined" (honours the footer's opt-out promise).
 */
export async function checkOutreachReplies(): Promise<ReplyCheckResult> {
  const out: ReplyCheckResult = { ok: true, checked: 0, replied: 0, optedOut: 0, errors: [] };
  const a = await auth();
  if (!isAuth(a)) return { ...out, ok: false, errors: [a.ok ? "" : a.error], notConfigured: !a.ok && a.notConfigured };
  const db = await getDb();
  const rows = await db
    .select({ o: schema.outreach, creatorName: schema.creators.name })
    .from(schema.outreach)
    .innerJoin(schema.creators, eq(schema.creators.id, schema.outreach.creatorId))
    .where(and(isNotNull(schema.outreach.gmailThreadId), inArray(schema.outreach.stage, ["contacted", "followed_up"])));
  const { upsertOutreach, updateCreator } = await ops();

  for (const { o, creatorName } of rows) {
    out.checked++;
    try {
      const t = await getThread(a.token, o.gmailThreadId!, ["From"]);
      const since = o.contactedAt?.getTime() ?? 0;
      const theirs = (t.messages ?? []).filter((m) => {
        const from = addressOf(header(m, "From"));
        return from && from !== a.address && !(m.labelIds ?? []).includes("SENT") && Number(m.internalDate ?? 0) > since;
      });
      if (theirs.length === 0) continue;
      const stop = theirs.some((m) => /^\s*(stop|unsubscribe)\b/i.test(m.snippet ?? ""));
      if (stop) {
        await updateCreator(o.creatorId, { doNotContact: true }, "system");
        await upsertOutreach({ clientId: o.clientId, creatorId: o.creatorId, channel: o.channel, stage: "declined", notes: [o.notes, `Replied "stop" by email — marked do-not-contact.`].filter(Boolean).join("\n") }, "system");
        out.optedOut++;
      } else {
        await upsertOutreach({ clientId: o.clientId, creatorId: o.creatorId, channel: o.channel, stage: "replied" }, "system");
        out.replied++;
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) continue; // thread deleted
      out.ok = false;
      out.errors.push(`${creatorName}: ${e instanceof HttpError ? friendlyGoogleError(e, "Gmail") : errorText(e)}`);
      if (e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 429)) break;
    }
  }
  return out;
}
