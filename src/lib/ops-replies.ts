import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId } from "./ids";
import { logActivity } from "./activity";
import { OpsError } from "./ops";
import { REPLY_CATEGORIES, type ReplyCategory } from "@/components/reply-fill";

/**
 * Saved replies: one-tap message templates with {name} {business} {date} {link} placeholders.
 * People create/edit/delete them. Claude can only *suggest* one (status "suggested"); a person keeps or discards it.
 */

export type SavedReply = schema.SavedReply;

const isPerson = (actor: string) => actor !== "claude" && actor !== "system" && actor !== "public";
const t = (s: string) => s.replace(/\r\n/g, "\n").trim();

export const SavedReplyInput = z.object({
  title: z.string().trim().min(1, "Give it a title").max(120, "Keep the title under 120 characters"),
  body: z.string().trim().min(1, "Write the reply text").max(4000, "Keep it under 4,000 characters"),
  category: z.enum(REPLY_CATEGORIES).nullish(),
});

/** How many unreviewed suggestions Claude may have waiting at once. */
const MAX_PENDING_SUGGESTIONS = 15;

export async function listSavedReplies(status: "active" | "suggested" | "all" = "active") {
  const db = await getDb();
  return db
    .select()
    .from(schema.savedReplies)
    .where(status === "all" ? undefined : eq(schema.savedReplies.status, status))
    .orderBy(asc(schema.savedReplies.category), desc(schema.savedReplies.useCount), asc(schema.savedReplies.title));
}

export async function getSavedReply(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.savedReplies).where(eq(schema.savedReplies.id, id));
  return row ?? null;
}

/** A person adds an active reply; Claude's go in as "suggested" no matter what. */
export async function createSavedReply(input: z.input<typeof SavedReplyInput>, actor: string) {
  const v = SavedReplyInput.parse(input);
  const db = await getDb();
  const suggested = !isPerson(actor);
  if (suggested) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.savedReplies).where(eq(schema.savedReplies.status, "suggested"));
    if (n >= MAX_PENDING_SUGGESTIONS) throw new OpsError(`There are already ${n} suggested replies waiting for Nora or Cameron to review. Don't suggest more until they've gone through them.`);
    const [dupe] = await db.select({ id: schema.savedReplies.id }).from(schema.savedReplies)
      .where(sql`lower(${schema.savedReplies.title}) = ${v.title.toLowerCase()}`).limit(1);
    if (dupe) throw new OpsError(`A saved reply titled “${v.title}” already exists. Pick a different title or suggest something else.`);
  }
  const id = newId("rep_");
  await db.insert(schema.savedReplies).values({
    id, title: v.title, body: t(v.body), category: v.category ?? null, status: suggested ? "suggested" : "active", createdBy: actor,
  });
  await logActivity({
    actor, action: suggested ? "saved_reply.suggested" : "saved_reply.created", entityType: "saved_reply", entityId: id,
    summary: suggested ? `Suggested a saved reply “${v.title}”` : `Added saved reply “${v.title}”`,
  });
  return id;
}

export async function updateSavedReply(id: string, patch: Partial<z.input<typeof SavedReplyInput>>, actor: string) {
  if (!isPerson(actor)) throw new OpsError("Only a person can edit saved replies");
  const v = SavedReplyInput.partial().parse(patch);
  const set: Partial<typeof schema.savedReplies.$inferInsert> = { updatedAt: new Date() };
  if (v.title !== undefined) set.title = v.title;
  if (v.body !== undefined) set.body = t(v.body);
  if (v.category !== undefined) set.category = v.category ?? null;
  const db = await getDb();
  const [row] = await db.update(schema.savedReplies).set(set).where(eq(schema.savedReplies.id, id)).returning();
  if (!row) throw new OpsError("That saved reply doesn't exist anymore");
  await logActivity({ actor, action: "saved_reply.updated", entityType: "saved_reply", entityId: id, summary: `Edited saved reply “${row.title}”` });
}

export async function deleteSavedReply(id: string, actor: string) {
  if (!isPerson(actor)) throw new OpsError("Only a person can delete saved replies");
  const db = await getDb();
  const [row] = await db.delete(schema.savedReplies).where(eq(schema.savedReplies.id, id)).returning();
  if (!row) return;
  await logActivity({ actor, action: "saved_reply.deleted", entityType: "saved_reply", entityId: id, summary: `Deleted saved reply “${row.title}”` });
}

/** Keep one of Claude's suggestions (optionally with edits) → active. */
export async function keepSuggestedReply(id: string, actor: string, edits: Partial<z.input<typeof SavedReplyInput>> = {}) {
  if (!isPerson(actor)) throw new OpsError("Only a person can keep a suggested reply");
  const v = SavedReplyInput.partial().parse(edits);
  const db = await getDb();
  const [row] = await db.update(schema.savedReplies)
    .set({
      status: "active", updatedAt: new Date(),
      ...(v.title !== undefined ? { title: v.title } : {}),
      ...(v.body !== undefined ? { body: t(v.body) } : {}),
      ...(v.category !== undefined ? { category: v.category ?? null } : {}),
    })
    .where(and(eq(schema.savedReplies.id, id), eq(schema.savedReplies.status, "suggested"))).returning();
  if (!row) throw new OpsError("That suggestion was already handled");
  await logActivity({ actor, action: "saved_reply.kept", entityType: "saved_reply", entityId: id, summary: `Kept suggested reply “${row.title}”` });
}

export async function discardSuggestedReply(id: string, actor: string) {
  if (!isPerson(actor)) throw new OpsError("Only a person can discard a suggested reply");
  const db = await getDb();
  const [row] = await db.delete(schema.savedReplies)
    .where(and(eq(schema.savedReplies.id, id), eq(schema.savedReplies.status, "suggested"))).returning();
  if (!row) return;
  await logActivity({ actor, action: "saved_reply.discarded", entityType: "saved_reply", entityId: id, summary: `Discarded suggested reply “${row.title}”` });
}

/** Counts a use (insert/copy). A counter, not an audit event, so it isn't written to the activity log. */
export async function recordReplyUse(id: string) {
  const db = await getDb();
  await db.update(schema.savedReplies)
    .set({ useCount: sql`${schema.savedReplies.useCount} + 1` })
    .where(and(eq(schema.savedReplies.id, id), eq(schema.savedReplies.status, "active")));
}

/* ───────────────────────── Defaults ───────────────────────── */

const SEEDED_KEY = "saved_replies_seeded";

export const DEFAULT_REPLIES: Array<{ key: string; title: string; category: ReplyCategory; body: string }> = [
  {
    key: "rates",
    title: "Rates & next steps (paid)",
    category: "collab",
    body:
      "Hi {name}! Thank you so much for reaching out — I'd love to work with {business}.\n\n" +
      "My paid collabs start at $600 (the details are in my media kit). If you have something different in mind, just reply here and I'm happy to put together a custom package.\n\n" +
      "Next step: send me a couple of dates that work for a visit and what you'd most like to highlight, and I'll confirm everything in writing.\n\n" +
      "Talk soon,\nNora",
  },
  {
    key: "not_a_fit",
    title: "Thanks — not a fit right now",
    category: "collab",
    body:
      "Hi {name}, thank you for thinking of me — {business} looks lovely! I'm not able to take this one on right now, " +
      "but I'd love to stay in touch, so please reach out again down the road.\n\nWarmly,\nNora",
  },
  {
    key: "visit_confirm",
    title: "Visit confirmation",
    category: "collab",
    body:
      "Hi {name}! Just confirming my visit to {business} on {date}. I'll arrive a few minutes early to grab some shots of the space " +
      "before it gets busy — let me know if there's anyone I should ask for or a best spot to park.\n\nCan't wait!\nNora",
  },
  {
    key: "disclosure",
    title: "Disclosure reminder",
    category: "collab",
    body:
      "Quick heads-up so we're on the same page: because this is a partnership, my posts will be clearly labeled " +
      "(a paid-partnership tag and #ad, or #gifted for a hosted visit). It's an FTC rule and it keeps things trustworthy for my followers — " +
      "and my take on the food will always be my honest one.\n\nThanks for understanding!\nNora",
  },
  {
    key: "live",
    title: "Content is live",
    category: "collab",
    body:
      "Hi {name}! Your {business} post is live: {link}\n\n" +
      "Thank you again for having me. Feel free to share or repost (just tag me), and I'll send a quick recap of how it did once it's had a week to settle.\n\nNora",
  },
  {
    key: "report_sent",
    title: "Monthly report sent",
    category: "client",
    body:
      "Hi {name}! Your monthly report for {business} is in your inbox. The highlights are right at the top — " +
      "happy to hop on a quick call if you'd like to walk through it or change anything for next month.\n\nThanks as always,\nNora",
  },
  {
    key: "access",
    title: "Need access/login (via Meta Business Suite / Manager)",
    category: "client",
    body:
      "Hi {name}! To keep things running smoothly for {business}, could you give me access through Meta Business Suite? " +
      "Go to Settings → People → Add people, enter my email, and give me access to your Instagram account and Facebook Page " +
      "(in Business Manager it's Users → People). That way you never have to share a password.\n\n" +
      "Happy to walk you through it — it only takes a couple of minutes.\n\nThank you!\nNora",
  },
  {
    key: "thanks",
    title: "Quick thank-you",
    category: "general",
    body: "Thank you so much, {name}! I really appreciate it. Talk soon!\n\nNora",
  },
];

/**
 * Seeds the defaults once, only if the table is empty. Idempotent and safe under concurrent page loads:
 * fixed ids + ON CONFLICT DO NOTHING, and a marker in app_settings so deleting every reply later doesn't re-seed.
 */
export async function ensureDefaultReplies() {
  const db = await getDb();
  const [marker] = await db.select({ key: schema.appSettings.key }).from(schema.appSettings).where(eq(schema.appSettings.key, SEEDED_KEY));
  if (marker) return false;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.savedReplies);
  if (n === 0) {
    await db.insert(schema.savedReplies)
      .values(DEFAULT_REPLIES.map((r) => ({ id: `rep_default_${r.key}`, title: r.title, body: r.body, category: r.category, status: "active" as const, createdBy: "system" })))
      .onConflictDoNothing();
  }
  await db.insert(schema.appSettings).values({ key: SEEDED_KEY, value: { at: new Date().toISOString(), seeded: n === 0 }, updatedBy: "system" }).onConflictDoNothing();
  if (n === 0)
    await logActivity({ actor: "system", action: "saved_reply.seeded", entityType: "saved_reply", entityId: "defaults", summary: `Added ${DEFAULT_REPLIES.length} starter saved replies` });
  return n === 0;
}
