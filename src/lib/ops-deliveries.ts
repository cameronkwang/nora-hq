import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError, updateAsk } from "./ops";
import { notifyDelivery } from "./notify";
import { isAppFileUrl } from "./uploads";

/**
 * "Delivered": finished work handed to Nora (or Cameron). Same conventions as lib/ops: zod-validated input,
 * `actor` is a user email or "claude", one activity entry per call.
 *
 *  - deliver(): a person in the app (/delivered/new) hands over a finished thing: a title, an optional note,
 *    and files that are already in Nora HQ. It lands unread in the recipient's Delivered tab and on Nora's Home,
 *    and pushes a notification (unless her notifications are paused).
 *  - markSeen(): the recipient opened it. Only the recipient's own view marks it seen.
 *
 * Nora's Delivered inbox is for finished deliverables (a flyer, edited photos, a caption). Creator outreach (DMs or
 * emails to creators) never goes there: it stays in Outreach and Review. deliver() refuses it for Nora, and the
 * "Deliver to Nora" pickers and links leave out asks that are creator outreach.
 */

/** Draft kinds that are messages to creators. An ask with one of these linked is creator outreach. */
const CREATOR_OUTREACH_DRAFTS = ["outreach_email", "outreach_dm"] as const;

/** Text that is plainly about messaging creators: "DM these creators", "creator outreach", "pitch the influencers". */
const CREATOR_WORD = String.raw`(?:creators?|influencers?|ugc)`;
const DM_WORD = String.raw`(?:dms?|dm'?ing|direct messages?|outreach|reach(?:ing)? out|pitch(?:es|ing)?|cold messages?)`;
const CREATOR_DM_RE = new RegExp(String.raw`\b${CREATOR_WORD}\b[\s\S]{0,60}\b${DM_WORD}\b|\b${DM_WORD}\b[\s\S]{0,60}\b${CREATOR_WORD}\b`, "i");

export function isCreatorOutreachText(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && CREATOR_DM_RE.test(t));
}

/** Of these asks, the ones that are creator outreach: a creator DM/email draft is linked, or the ask itself is about DMing creators. */
export async function creatorOutreachAskIds(askIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!askIds.length) return out;
  const db = await getDb();
  const [drafts, asks] = await Promise.all([
    db.select({ askId: schema.drafts.askId }).from(schema.drafts)
      .where(and(inArray(schema.drafts.askId, askIds), inArray(schema.drafts.kind, [...CREATOR_OUTREACH_DRAFTS]))),
    db.select({ id: schema.asks.id, body: schema.asks.body }).from(schema.asks).where(inArray(schema.asks.id, askIds)),
  ]);
  for (const d of drafts) if (d.askId) out.add(d.askId);
  for (const a of asks) if (isCreatorOutreachText(a.body)) out.add(a.id);
  return out;
}

const NOT_FOR_NORA = "Creator outreach doesn't go in Nora's Delivered inbox. It stays in Outreach and Review.";

const MAX_FILES = 20;

export const DeliveryInput = z.object({
  recipient: z.enum(schema.DELIVERY_RECIPIENTS).default("nora"),
  title: z.string().trim().min(1, "Give it a short title").max(140),
  note: z.string().trim().max(4000).nullish(),
  attachments: z
    .array(z.object({ url: z.string().max(1000), name: z.string().trim().min(1).max(200), contentType: z.string().max(100).optional() }))
    .max(MAX_FILES)
    .default([]),
  askId: z.string().nullish(),
  clientId: z.string().nullish(),
  /** Also mark the linked ask done (the delivery is the answer to it). */
  closeAsk: z.boolean().default(false),
});

export async function deliver(input: z.input<typeof DeliveryInput>, actor: string) {
  const v = DeliveryInput.parse(input);
  if (!v.note && v.attachments.length === 0) throw new OpsError("Add a file or a note: there's nothing to deliver yet.");
  const bad = v.attachments.find((a) => !isAppFileUrl(a.url));
  if (bad) throw new OpsError(`"${bad.name}" isn't a file stored in Nora HQ. Upload it in the app first.`);
  if (v.recipient === "nora") {
    if (isCreatorOutreachText(v.title, v.note)) throw new OpsError(NOT_FOR_NORA);
    if (v.askId && (await creatorOutreachAskIds([v.askId])).size) throw new OpsError(NOT_FOR_NORA);
  }

  const db = await getDb();
  let clientId = v.clientId || null;
  if (v.askId) {
    const [ask] = await db.select({ id: schema.asks.id, clientId: schema.asks.clientId }).from(schema.asks).where(eq(schema.asks.id, v.askId));
    if (!ask) throw new OpsError(`ask ${v.askId} not found`);
    clientId ??= ask.clientId;
  }
  if (clientId) {
    const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!c) throw new OpsError(`No business with id "${clientId}"`);
  }

  const id = newId("dlv_");
  const [row] = await db.insert(schema.deliveries).values({
    id,
    recipient: v.recipient,
    title: v.title,
    note: v.note || null,
    attachments: v.attachments,
    askId: v.askId || null,
    clientId,
    createdBy: actor,
  }).returning();

  const files = v.attachments.length ? ` (${v.attachments.length} file${v.attachments.length === 1 ? "" : "s"})` : "";
  await logActivity({
    actor,
    action: "delivery.created",
    entityType: "delivery",
    entityId: id,
    clientId,
    summary: `Delivered to ${v.recipient === "nora" ? "Nora" : "Cameron"}: ${v.title}${files}`,
  });
  if (v.askId && v.closeAsk) await updateAsk(v.askId, { status: "done" }, actor);
  notifyDelivery(row, actor);
  return row;
}

/** The recipient opened it. Idempotent; anyone else opening it changes nothing. */
export async function markSeen(id: string, viewer: string) {
  const db = await getDb();
  await db.update(schema.deliveries).set({ seenAt: new Date() })
    .where(and(eq(schema.deliveries.id, id), eq(schema.deliveries.recipient, viewer as schema.DeliveryRecipient), isNull(schema.deliveries.seenAt)));
}

/** Marks everything for `viewer` seen ("Mark all as seen"). */
export async function markAllSeen(viewer: schema.DeliveryRecipient) {
  const db = await getDb();
  await db.update(schema.deliveries).set({ seenAt: new Date() })
    .where(and(eq(schema.deliveries.recipient, viewer), isNull(schema.deliveries.seenAt)));
}

/** How many deliveries `recipient` hasn't opened yet (the count on the Delivered tab, the Inbox and Nora's Home). */
export async function unseenDeliveries(recipient: string | null): Promise<number> {
  if (recipient !== "nora" && recipient !== "cameron") return 0;
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.deliveries)
    .where(and(eq(schema.deliveries.recipient, recipient), isNull(schema.deliveries.seenAt)));
  return r?.n ?? 0;
}

/** Newest first; unopened ones first when `unseenFirst`. */
export async function listDeliveries(opts: { recipient?: schema.DeliveryRecipient; limit?: number; unseenFirst?: boolean } = {}) {
  const db = await getDb();
  const d = schema.deliveries;
  return db
    .select({ delivery: d, client: { id: schema.clients.id, name: schema.clients.name, location: schema.clients.location } })
    .from(d)
    .leftJoin(schema.clients, eq(d.clientId, schema.clients.id))
    .where(opts.recipient ? eq(d.recipient, opts.recipient) : undefined)
    .orderBy(...(opts.unseenFirst ? [sql`${d.seenAt} is not null`] : []), desc(d.createdAt))
    .limit(opts.limit ?? 200);
}

/** Deliveries that answer these asks (the ask page lists them). */
export async function deliveriesForAsks(askIds: string[]) {
  if (!askIds.length) return [];
  const db = await getDb();
  return db.select().from(schema.deliveries).where(inArray(schema.deliveries.askId, askIds)).orderBy(desc(schema.deliveries.createdAt));
}
