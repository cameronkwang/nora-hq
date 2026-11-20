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
 *  - deliver(): a person in the app (/delivered/new) or Claude (deliver_to_nora) hands over a finished thing:
 *    a title, an optional note, and files that are already in Nora HQ. It lands unread in the recipient's
 *    Delivered tab and on Nora's Home, and pushes a notification (unless her notifications are paused).
 *  - markSeen(): the recipient opened it. Only the recipient's own view marks it seen.
 */

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
