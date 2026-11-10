import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db";
import { newId, slugify } from "./ids";
import { currentMonth, isMonth, monthOfDate } from "./dates";
import { logActivity } from "./activity";
import { publishInstagramPost, replyToInstagramComment } from "./integrations/instagram";
import { replyToGoogleReview } from "./integrations/google";
import { sendOutreachEmail } from "./integrations/gmail";
import { postReviewKey } from "./post-key";
import type { IntegrationResult } from "./integrations/types";

/**
 * The ONLY place that mutates data. Both the web UI (server actions) and the Claude connector (MCP tools)
 * call these, so behaviour, validation and the audit log stay identical.
 * `actor` is a user email, or "claude".
 *
 * Safety rule: nothing here sends/publishes anything except approveDraft() and publishDuePosts(),
 * and approveDraft() refuses actor "claude" — only a signed-in human can approve.
 */

export class OpsError extends Error {}

const d = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const handle = (s: string | null | undefined) => {
  const v = d(s);
  return v ? v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, "").replace(/\/.*$/, "").toLowerCase() : null;
};

/* ───────────────────────── Clients & monthly plan ───────────────────────── */

export const ClientInput = z.object({
  name: z.string().min(1),
  location: z.string().nullish(),
  brand: z.string().nullish(),
  instagramHandle: z.string().nullish(),
  tiktokHandle: z.string().nullish(),
  website: z.string().nullish(),
  googleLocation: z.string().nullish(),
  brandVoice: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function createClient(input: z.input<typeof ClientInput>, actor: string) {
  const v = ClientInput.parse(input);
  const db = await getDb();
  let id = slugify(`${v.name} ${v.location ?? ""}`) || newId("c_");
  const [exists] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, id));
  if (exists) id = `${id}-${newId().slice(-4).toLowerCase()}`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.clients);
  const { DEFAULT_DELIVERABLES } = await import("./seed");
  await db.insert(schema.clients).values({
    id, name: v.name.trim(), location: d(v.location), brand: d(v.brand), instagramHandle: handle(v.instagramHandle),
    tiktokHandle: handle(v.tiktokHandle), website: d(v.website), googleLocation: d(v.googleLocation),
    brandVoice: d(v.brandVoice), notes: d(v.notes), sortOrder: n,
  });
  await db.insert(schema.deliverables).values(DEFAULT_DELIVERABLES.map((x, i) => ({ id: newId("dlv_"), clientId: id, sortOrder: i, ...x })));
  await logActivity({ actor, action: "client.created", entityType: "client", entityId: id, clientId: id, summary: `Added business ${v.name}` });
  return id;
}

export async function updateClient(id: string, patch: Partial<z.input<typeof ClientInput>> & { archived?: boolean }, actor: string) {
  const db = await getDb();
  const v = ClientInput.partial().parse(patch);
  const set: Partial<typeof schema.clients.$inferInsert> = {};
  if (v.name !== undefined) set.name = v.name.trim();
  for (const k of ["location", "brand", "website", "googleLocation", "brandVoice", "notes"] as const) if (v[k] !== undefined) set[k] = d(v[k]);
  if (v.instagramHandle !== undefined) set.instagramHandle = handle(v.instagramHandle);
  if (v.tiktokHandle !== undefined) set.tiktokHandle = handle(v.tiktokHandle);
  if (patch.archived !== undefined) set.archived = patch.archived;
  if (Object.keys(set).length === 0) return;
  await db.update(schema.clients).set(set).where(eq(schema.clients.id, id));
  await logActivity({ actor, action: "client.updated", entityType: "client", entityId: id, clientId: id, summary: `Updated business details (${Object.keys(set).join(", ")})` });
}

export const DeliverableInput = z.object({
  id: z.string().optional(),
  clientId: z.string(),
  title: z.string().min(1),
  platform: z.enum(schema.PLATFORMS),
  targetPerMonth: z.coerce.number().int().min(0).max(999),
  active: z.boolean().optional(),
});

export async function upsertDeliverable(input: z.input<typeof DeliverableInput>, actor: string) {
  const v = DeliverableInput.parse(input);
  const db = await getDb();
  if (v.id) {
    await db.update(schema.deliverables)
      .set({ title: v.title, platform: v.platform, targetPerMonth: v.targetPerMonth, ...(v.active !== undefined ? { active: v.active } : {}) })
      .where(and(eq(schema.deliverables.id, v.id), eq(schema.deliverables.clientId, v.clientId)));
    await logActivity({ actor, action: "deliverable.updated", entityType: "deliverable", entityId: v.id, clientId: v.clientId, summary: `Monthly plan: ${v.title} → ${v.targetPerMonth || "as needed"}/mo` });
    return v.id;
  }
  const id = newId("dlv_");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.deliverables).where(eq(schema.deliverables.clientId, v.clientId));
  await db.insert(schema.deliverables).values({ id, clientId: v.clientId, title: v.title, platform: v.platform, targetPerMonth: v.targetPerMonth, sortOrder: n });
  await logActivity({ actor, action: "deliverable.created", entityType: "deliverable", entityId: id, clientId: v.clientId, summary: `Monthly plan: added ${v.title} (${v.targetPerMonth || "as needed"}/mo)` });
  return id;
}

export async function deleteDeliverable(id: string, actor: string) {
  const db = await getDb();
  const [row] = await db.delete(schema.deliverables).where(eq(schema.deliverables.id, id)).returning();
  if (row) await logActivity({ actor, action: "deliverable.deleted", entityType: "deliverable", entityId: id, clientId: row.clientId, summary: `Monthly plan: removed ${row.title}` });
}

/* ───────────────────────── Asks ───────────────────────── */

export const AskInput = z.object({
  clientId: z.string().nullish(),
  body: z.string().min(1),
  attachments: z.array(z.object({ url: z.string(), name: z.string(), contentType: z.string().optional() })).default([]),
});

export async function createAsk(input: z.input<typeof AskInput>, actor: string) {
  const v = AskInput.parse(input);
  const db = await getDb();
  const id = newId("ask_");
  await db.insert(schema.asks).values({ id, clientId: v.clientId || null, body: v.body.trim(), attachments: v.attachments, createdBy: actor });
  await logActivity({ actor, action: "ask.created", entityType: "ask", entityId: id, clientId: v.clientId, summary: `New ask: ${v.body.slice(0, 80)}` });
  return id;
}

export async function updateAsk(id: string, patch: { status?: schema.AskStatus; claudeNote?: string | null; clientId?: string | null }, actor: string) {
  const db = await getDb();
  const set: Partial<typeof schema.asks.$inferInsert> = { updatedAt: new Date() };
  if (patch.status) {
    if (!schema.ASK_STATUSES.includes(patch.status)) throw new OpsError(`bad status ${patch.status}`);
    set.status = patch.status;
  }
  if (patch.claudeNote !== undefined) set.claudeNote = d(patch.claudeNote);
  if (patch.clientId !== undefined) set.clientId = patch.clientId || null;
  const [row] = await db.update(schema.asks).set(set).where(eq(schema.asks.id, id)).returning();
  if (!row) throw new OpsError(`ask ${id} not found`);
  await logActivity({ actor, action: "ask.updated", entityType: "ask", entityId: id, clientId: row.clientId, summary: patch.status ? `Ask marked ${patch.status.replace("_", " ")}` : "Ask updated" });
  return row;
}

/* ───────────────────────── Tasks ───────────────────────── */

export const TaskInput = z.object({
  clientId: z.string().nullish(),
  title: z.string().min(1),
  details: z.string().nullish(),
  platform: z.enum(schema.PLATFORMS).nullish(),
  status: z.enum(schema.TASK_STATUSES).default("todo"),
  assignee: z.enum(schema.ASSIGNEES).default("unassigned"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  month: z.string().refine(isMonth, "month must be YYYY-MM").nullish(),
  deliverableId: z.string().nullish(),
  askId: z.string().nullish(),
});

export async function createTask(input: z.input<typeof TaskInput>, actor: string) {
  const v = TaskInput.parse(input);
  const db = await getDb();
  const id = newId("tsk_");
  const month = v.month ?? (v.dueDate ? monthOfDate(v.dueDate) : currentMonth());
  await db.insert(schema.tasks).values({
    id, clientId: v.clientId || null, title: v.title.trim(), details: d(v.details), platform: v.platform ?? null,
    status: v.status, assignee: v.assignee, dueDate: v.dueDate ?? null, month, deliverableId: v.deliverableId || null,
    askId: v.askId || null, createdBy: actor, completedAt: v.status === "done" ? new Date() : null,
  });
  await logActivity({ actor, action: "task.created", entityType: "task", entityId: id, clientId: v.clientId, summary: `Task: ${v.title}` });
  return id;
}

export async function updateTask(id: string, patch: Partial<z.input<typeof TaskInput>>, actor: string) {
  const v = TaskInput.partial().parse(patch);
  const db = await getDb();
  const set: Partial<typeof schema.tasks.$inferInsert> = {};
  if (v.title !== undefined) set.title = v.title.trim();
  if (v.details !== undefined) set.details = d(v.details);
  if (v.platform !== undefined) set.platform = v.platform ?? null;
  if (v.assignee !== undefined) set.assignee = v.assignee;
  if (v.clientId !== undefined) set.clientId = v.clientId || null;
  if (v.deliverableId !== undefined) set.deliverableId = v.deliverableId || null;
  if (v.dueDate !== undefined) set.dueDate = v.dueDate ?? null;
  if (v.month !== undefined && v.month) set.month = v.month;
  if (patch.status !== undefined && v.status) {
    set.status = v.status;
    set.completedAt = v.status === "done" ? new Date() : null;
  }
  const [row] = await db.update(schema.tasks).set(set).where(eq(schema.tasks.id, id)).returning();
  if (!row) throw new OpsError(`task ${id} not found`);
  await logActivity({ actor, action: "task.updated", entityType: "task", entityId: id, clientId: row.clientId, summary: set.status ? `Task “${row.title}” → ${set.status.replace("_", " ")}` : `Edited task “${row.title}”` });
  return row;
}

export async function deleteTask(id: string, actor: string) {
  const db = await getDb();
  const [row] = await db.delete(schema.tasks).where(eq(schema.tasks.id, id)).returning();
  if (row) await logActivity({ actor, action: "task.deleted", entityType: "task", entityId: id, clientId: row.clientId, summary: `Deleted task “${row.title}”` });
}

/* ───────────────────────── Content calendar ───────────────────────── */

export const PostInput = z.object({
  clientId: z.string(),
  platform: z.enum(schema.POST_PLATFORMS),
  format: z.enum(schema.POST_FORMATS).default("feed"),
  caption: z.string().nullish(),
  mediaUrls: z.array(z.string().url()).default([]),
  scheduledFor: z.coerce.date().nullish(),
  publishMode: z.enum(["auto", "manual"]).default("manual"),
  status: z.enum(schema.POST_STATUSES).default("idea"),
  taskId: z.string().nullish(),
});

export async function createPost(input: z.input<typeof PostInput>, actor: string) {
  const v = PostInput.parse(input);
  if (v.platform === "tiktok" && v.publishMode === "auto") v.publishMode = "manual"; // TikTok API posts are private-only until audited
  const db = await getDb();
  const id = newId("pst_");
  await db.insert(schema.contentPosts).values({ id, ...v, caption: d(v.caption), scheduledFor: v.scheduledFor ?? null, taskId: v.taskId || null, createdBy: actor });
  await logActivity({ actor, action: "post.created", entityType: "post", entityId: id, clientId: v.clientId, summary: `Calendar: ${v.platform} ${v.format}${v.scheduledFor ? ` for ${v.scheduledFor.toISOString().slice(0, 10)}` : ""}` });
  return id;
}

export async function updatePost(id: string, patch: Partial<z.input<typeof PostInput>> & { permalink?: string | null }, actor: string) {
  const v = PostInput.partial().parse(patch);
  const db = await getDb();
  const set: Partial<typeof schema.contentPosts.$inferInsert> = {};
  if (v.format !== undefined) set.format = v.format;
  if (v.caption !== undefined) set.caption = d(v.caption);
  if (v.mediaUrls !== undefined) set.mediaUrls = v.mediaUrls;
  if (v.scheduledFor !== undefined) set.scheduledFor = v.scheduledFor ?? null;
  if (v.publishMode !== undefined) set.publishMode = v.publishMode;
  // Conditional on the current status: nothing changes while a post is publishing, and a published post can't be
  // moved back to an earlier status (a stale page would otherwise make it eligible to post a second time).
  let from: schema.PostStatus[] = ["idea", "drafted", "approved", "scheduled", "failed", "published"];
  if (patch.status !== undefined && v.status) {
    if (v.status === "scheduled" || v.status === "publishing") throw new OpsError("Use approveDraft / schedulePost to schedule");
    set.status = v.status;
    if (v.status === "published") set.publishedAt = new Date();
    else from = ["idea", "drafted", "approved", "scheduled", "failed"];
  }
  if (patch.permalink !== undefined) set.permalink = d(patch.permalink);
  const [row] = await db.update(schema.contentPosts).set(set)
    .where(and(eq(schema.contentPosts.id, id), inArray(schema.contentPosts.status, from))).returning();
  if (!row) {
    const [cur] = await db.select({ status: schema.contentPosts.status }).from(schema.contentPosts).where(eq(schema.contentPosts.id, id));
    if (!cur) throw new OpsError(`post ${id} not found`);
    throw new OpsError(cur.status === "publishing" ? "This post is publishing to Instagram right now — wait for it to finish." : `This post is already ${cur.status} — reload the page.`);
  }
  if (row.platform === "tiktok" && row.publishMode === "auto") await db.update(schema.contentPosts).set({ publishMode: "manual" }).where(eq(schema.contentPosts.id, id));
  await logActivity({ actor, action: "post.updated", entityType: "post", entityId: id, clientId: row.clientId, summary: set.status ? `Calendar post → ${set.status}` : "Edited calendar post" });
  if (set.status === "published" && row.taskId) await updateTask(row.taskId, { status: "done" }, actor);
  return row;
}

const SCHEDULABLE: schema.PostStatus[] = ["idea", "drafted", "approved", "failed"];

/** Human-only: put an approved Instagram auto-publish post on the schedule. */
export async function schedulePost(id: string, actor: string) {
  if (actor === "claude") throw new OpsError("Only a person can schedule a post");
  const db = await getDb();
  const [row] = await db.select().from(schema.contentPosts).where(eq(schema.contentPosts.id, id));
  if (!row) throw new OpsError("post not found");
  if (!row.scheduledFor) throw new OpsError("Set a date/time first");
  if (row.platform !== "instagram" || row.publishMode !== "auto") throw new OpsError("Only Instagram posts set to auto-publish can be scheduled");
  if (row.mediaUrls.length === 0) throw new OpsError("Add at least one media URL");
  // Conditional on the current status so a stale page can't put a published (or in-flight) post back on the schedule.
  const [ok] = await db.update(schema.contentPosts).set({ status: "scheduled", error: null })
    .where(and(eq(schema.contentPosts.id, id), inArray(schema.contentPosts.status, SCHEDULABLE))).returning({ id: schema.contentPosts.id });
  if (!ok) throw new OpsError(`This post is already ${row.status === "publishing" ? "publishing" : row.status === "published" ? "published" : "scheduled"} — reload the page.`);
  await logActivity({ actor, action: "post.scheduled", entityType: "post", entityId: id, clientId: row.clientId, summary: `Scheduled Instagram ${row.format} for ${row.scheduledFor.toISOString()}` });
}

export async function deletePost(id: string, actor: string) {
  const db = await getDb();
  const [row] = await db.delete(schema.contentPosts).where(eq(schema.contentPosts.id, id)).returning();
  if (row) await logActivity({ actor, action: "post.deleted", entityType: "post", entityId: id, clientId: row.clientId, summary: `Removed ${row.platform} post from calendar` });
}

/** A post left in "publishing" longer than this was abandoned by a killed run (the cron function caps at 60s). */
const STUCK_PUBLISHING_MS = 10 * 60_000;

/**
 * Called by the cron route (maxDuration 60s). Claims each due post (scheduled → publishing) before calling Instagram,
 * so overlapping runs can't double-post. The whole run shares one time budget: it stops claiming posts when there
 * isn't time to finish another, so nothing is claimed and then killed mid-publish. Posts still left in
 * "publishing" by a crash are moved to failed on the next run.
 */
export async function publishDuePosts(now = new Date(), budgetMs = 50_000) {
  const db = await getDb();
  const runDeadline = Date.now() + budgetMs;

  // Recovery: anything claimed long ago (or claimed before claimedAt existed) and never finished.
  const stuck = await db.update(schema.contentPosts)
    .set({ status: "failed", claimedAt: null, error: "Publishing was interrupted. Check the Instagram account before retrying — it may already have posted." })
    .where(and(
      eq(schema.contentPosts.status, "publishing"),
      or(isNull(schema.contentPosts.claimedAt), lt(schema.contentPosts.claimedAt, new Date(now.getTime() - STUCK_PUBLISHING_MS))),
    )).returning({ id: schema.contentPosts.id, clientId: schema.contentPosts.clientId });
  for (const p of stuck)
    await logActivity({ actor: "system", action: "post.failed", entityType: "post", entityId: p.id, clientId: p.clientId, summary: "Instagram publish was interrupted; marked failed" });

  const due = await db.select().from(schema.contentPosts).where(and(
    eq(schema.contentPosts.status, "scheduled"), eq(schema.contentPosts.publishMode, "auto"),
    eq(schema.contentPosts.platform, "instagram"), lte(schema.contentPosts.scheduledFor, now),
  )).orderBy(asc(schema.contentPosts.scheduledFor));
  const results: Array<{ id: string; ok: boolean; error?: string; retrying?: boolean }> = [];
  for (const p of due) {
    // media_publish (≤20s) + permalink (≤5s) come after polling; don't start a post that can't get ~10s of polling too.
    if (runDeadline - Date.now() < 35_000) break; // the next run (15 min) picks the rest up
    const [claimed] = await db.update(schema.contentPosts).set({ status: "publishing", claimedAt: new Date() })
      .where(and(eq(schema.contentPosts.id, p.id), eq(schema.contentPosts.status, "scheduled"))).returning();
    if (!claimed) continue;
    let r: IntegrationResult;
    try {
      r = await publishInstagramPost(claimed, { deadline: runDeadline - 25_000 });
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    try {
      if (r.ok) {
        await db.update(schema.contentPosts).set({ status: "published", publishedAt: new Date(), externalId: r.externalId ?? null, permalink: r.permalink ?? null, error: null, claimedAt: null, igContainer: null }).where(eq(schema.contentPosts.id, p.id));
        await logActivity({ actor: "system", action: "post.published", entityType: "post", entityId: p.id, clientId: p.clientId, summary: `Published to Instagram${r.permalink ? `: ${r.permalink}` : ""}` });
        if (p.taskId) await updateTask(p.taskId, { status: "done" }, "system");
      } else if (r.pendingContainer) {
        // Still processing on Instagram's side: back on the schedule, resume polling the same container next run.
        await db.update(schema.contentPosts).set({ status: "scheduled", error: r.error, claimedAt: null, igContainer: r.pendingContainer }).where(eq(schema.contentPosts.id, p.id));
      } else {
        await db.update(schema.contentPosts).set({ status: "failed", error: r.error, claimedAt: null }).where(eq(schema.contentPosts.id, p.id));
        await logActivity({ actor: "system", action: "post.failed", entityType: "post", entityId: p.id, clientId: p.clientId, summary: `Instagram publish failed: ${r.error}` });
      }
    } catch (e) {
      // Bookkeeping failed; don't abort the run. The stuck-publishing recovery above handles this post next time.
      console.error("[publish] bookkeeping failed for", p.id, e);
    }
    results.push({ id: p.id, ok: r.ok, error: r.ok ? undefined : r.error, retrying: !r.ok && !!r.pendingContainer });
  }
  return results;
}

/* ───────────────────────── Drafts & approvals ───────────────────────── */

export const DraftInput = z.object({
  clientId: z.string().nullish(),
  kind: z.enum(schema.DRAFT_KINDS),
  title: z.string().min(1),
  body: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).default({}),
  taskId: z.string().nullish(),
  askId: z.string().nullish(),
});

export async function createDraft(input: z.input<typeof DraftInput>, actor = "claude") {
  const v = DraftInput.parse(input);
  const db = await getDb();
  // Validate the references each kind needs so approval can't fail later on a dangling id.
  if (v.kind === "review_reply") {
    const [r] = await db.select({ id: schema.reviews.id }).from(schema.reviews).where(eq(schema.reviews.id, String(v.meta.reviewId ?? "")));
    if (!r) throw new OpsError("review_reply drafts need meta.reviewId of a synced Google review");
  }
  if (v.kind === "outreach_email" || v.kind === "outreach_dm") {
    const [o] = await db.select().from(schema.outreach).where(eq(schema.outreach.id, String(v.meta.outreachId ?? "")));
    if (!o) throw new OpsError(`${v.kind} drafts need meta.outreachId (create it with upsertOutreach first)`);
    v.clientId = v.clientId ?? o.clientId;
    if (v.kind === "outreach_email") {
      const [c] = await db.select().from(schema.creators).where(eq(schema.creators.id, o.creatorId));
      if (c?.doNotContact) throw new OpsError("This creator is marked do-not-contact");
      if (!v.meta.to && !c?.email) throw new OpsError("No email address for this creator — set creator.email or meta.to");
      v.meta.to = v.meta.to ?? c!.email;
      if (!v.meta.subject) throw new OpsError("outreach_email drafts need meta.subject");
    }
  }
  if (v.kind === "instagram_post" || v.kind === "tiktok_post") {
    if (!v.meta.postId) {
      if (!v.clientId) throw new OpsError("post drafts need clientId");
      v.meta.postId = await createPost({
        clientId: v.clientId, platform: v.kind === "instagram_post" ? "instagram" : "tiktok",
        format: (v.meta.format as never) ?? (v.kind === "tiktok_post" ? "video" : "feed"),
        caption: v.body, mediaUrls: (v.meta.mediaUrls as string[]) ?? [],
        scheduledFor: (v.meta.scheduledFor as string) ?? null, status: "drafted", taskId: v.taskId,
      }, actor);
    } else {
      await db.update(schema.contentPosts).set({ caption: v.body, status: "drafted" }).where(eq(schema.contentPosts.id, String(v.meta.postId)));
    }
  }
  const id = newId("drf_");
  await db.insert(schema.drafts).values({ id, clientId: v.clientId || null, kind: v.kind, title: v.title.trim(), body: v.body, meta: v.meta, taskId: v.taskId || null, askId: v.askId || null, createdBy: actor });
  if (v.taskId) await db.update(schema.tasks).set({ status: "needs_review" }).where(and(eq(schema.tasks.id, v.taskId), inArray(schema.tasks.status, ["todo", "in_progress", "blocked"])));
  await logActivity({ actor, action: "draft.created", entityType: "draft", entityId: id, clientId: v.clientId, summary: `Draft for review: ${v.title}` });
  return id;
}

/** Edit a draft's text before approving (or Claude revising after a rejection). */
export async function reviseDraft(id: string, patch: { body?: string; title?: string; meta?: Record<string, unknown> }, actor: string) {
  const db = await getDb();
  const [cur] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, id));
  if (!cur) throw new OpsError("draft not found");
  if (cur.status === "sent") throw new OpsError("Already sent — can't edit");
  const set: Partial<typeof schema.drafts.$inferInsert> = { updatedAt: new Date() };
  if (patch.body !== undefined) set.body = patch.body;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.meta !== undefined) set.meta = { ...cur.meta, ...patch.meta };
  if (actor === "claude" && cur.status === "rejected") {
    if (cur.kind === "outreach_email" || cur.kind === "outreach_dm") await assertContactable(cur);
    set.status = "needs_review"; // resubmission
  }
  await db.update(schema.drafts).set(set).where(eq(schema.drafts.id, id));
  if ((cur.kind === "instagram_post" || cur.kind === "tiktok_post") && patch.body !== undefined && cur.meta.postId)
    await db.update(schema.contentPosts).set({ caption: patch.body }).where(eq(schema.contentPosts.id, String(cur.meta.postId)));
  await logActivity({ actor, action: "draft.revised", entityType: "draft", entityId: id, clientId: cur.clientId, summary: `Revised draft “${cur.title}”` });
}

export async function rejectDraft(id: string, actor: string, note?: string) {
  if (actor === "claude") throw new OpsError("Only a person can reject");
  const db = await getDb();
  const [row] = await db.update(schema.drafts).set({ status: "rejected", reviewedBy: actor, reviewedAt: new Date(), reviewNote: d(note), updatedAt: new Date() })
    .where(and(eq(schema.drafts.id, id), eq(schema.drafts.status, "needs_review"))).returning();
  if (!row) throw new OpsError("Draft is no longer awaiting review");
  await logActivity({ actor, action: "draft.rejected", entityType: "draft", entityId: id, clientId: row.clientId, summary: `Sent back “${row.title}”${note ? `: ${note}` : ""}` });
}

export type ApproveOutcome = { status: schema.DraftStatus; message: string };

/**
 * Human approval. Claims the draft atomically (needs_review|failed → approved) so two people
 * clicking Approve at once can't double-send, then performs the side effect for its kind.
 */
export async function approveDraft(id: string, actor: string, opts: { body?: string; postKey?: string } = {}): Promise<ApproveOutcome> {
  if (actor === "claude" || actor === "system") throw new OpsError("Only a person can approve");
  const db = await getDb();
  const [cur] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, id));
  if (!cur) throw new OpsError("draft not found");
  if (cur.kind === "outreach_email" || cur.kind === "outreach_dm") await assertContactable(cur);
  if ((cur.kind === "instagram_post" || cur.kind === "tiktok_post") && cur.meta.postId) {
    // The reviewer approved what the review page showed them. If the post's media, time or format changed since
    // (e.g. Claude edited it), refuse rather than schedule something the person never saw.
    const [post] = await db.select().from(schema.contentPosts).where(eq(schema.contentPosts.id, String(cur.meta.postId)));
    if (post && opts.postKey !== postReviewKey(post))
      throw new OpsError("The post's photos/video, time or format changed since this page loaded. Reload and review it again before approving.");
  }
  const [draft] = await db.update(schema.drafts)
    .set({ status: "approved", reviewedBy: actor, reviewedAt: new Date(), error: null, updatedAt: new Date(), ...(opts.body !== undefined ? { body: opts.body } : {}) })
    .where(and(eq(schema.drafts.id, id), inArray(schema.drafts.status, ["needs_review", "failed"]))).returning();
  if (!draft) throw new OpsError("Someone already handled this draft");
  await logActivity({ actor, action: "draft.approved", entityType: "draft", entityId: id, clientId: draft.clientId, summary: `Approved “${draft.title}”` });

  const finish = async (r: IntegrationResult, okMsg: string, manualMsg: string): Promise<ApproveOutcome> => {
    if (r.ok) {
      await markDraftSent(id, actor, { threadId: r.threadId, permalink: r.permalink, sentByApi: true });
      return { status: "sent", message: okMsg };
    }
    if (r.notConfigured) return { status: "approved", message: manualMsg };
    await db.update(schema.drafts).set({ status: "failed", error: r.error }).where(eq(schema.drafts.id, id));
    await logActivity({ actor: "system", action: "draft.failed", entityType: "draft", entityId: id, clientId: draft.clientId, summary: `Sending failed: ${r.error}` });
    return { status: "failed", message: r.error };
  };

  switch (draft.kind) {
    case "review_reply": {
      const [review] = await db.select().from(schema.reviews).where(eq(schema.reviews.id, String(draft.meta.reviewId)));
      if (!review) return finish({ ok: false, error: "Review no longer exists" }, "", "");
      return finish(await replyToGoogleReview(review, draft.body), "Reply posted to Google.", "Approved. Google isn't connected yet, so copy the reply and post it from Google Maps, then click “Mark sent”.");
    }
    case "outreach_email": {
      const [o] = await db.select().from(schema.outreach).where(eq(schema.outreach.id, String(draft.meta.outreachId)));
      return finish(
        await sendOutreachEmail({ to: String(draft.meta.to), subject: String(draft.meta.subject), body: draft.body, threadId: o?.gmailThreadId }),
        `Email sent to ${String(draft.meta.to)}.`,
        "Approved. Gmail isn't connected yet, so send it yourself, then click “Mark sent”.",
      );
    }
    case "comment_reply": {
      return finish(
        await replyToInstagramComment({ clientId: draft.clientId ?? "", commentId: String(draft.meta.commentId), text: draft.body }),
        "Reply posted on Instagram.",
        "Approved. Reply from the Instagram app, then click “Mark sent”.",
      );
    }
    case "instagram_post":
    case "tiktok_post": {
      const postId = String(draft.meta.postId);
      await db.update(schema.contentPosts).set({ caption: draft.body, status: "approved" })
        .where(and(eq(schema.contentPosts.id, postId), inArray(schema.contentPosts.status, [...SCHEDULABLE, "scheduled"])));
      const [post] = await db.select().from(schema.contentPosts).where(eq(schema.contentPosts.id, postId));
      if (post && post.status === "approved" && post.platform === "instagram" && post.publishMode === "auto" && post.scheduledFor && post.mediaUrls.length > 0) {
        await schedulePost(postId, actor);
        return { status: "approved", message: `Approved and scheduled for ${post.scheduledFor.toLocaleString("en-US")}.` };
      }
      return { status: "approved", message: "Approved. It's on the calendar — post it from the app and mark it published." };
    }
    case "outreach_dm":
      return { status: "approved", message: "Approved. Copy it, send it from the app, then click “Mark sent”." };
    default:
      return { status: "approved", message: "Approved." };
  }
}

/**
 * Refuses outreach to a creator who opted out (do-not-contact) or whose relationship is declined.
 * Checked at draft creation AND again at approve / mark-sent, since the opt-out can arrive in between.
 */
async function assertContactable(draft: Pick<schema.Draft, "meta">) {
  const db = await getDb();
  const [row] = await db.select({ o: schema.outreach, c: schema.creators }).from(schema.outreach)
    .innerJoin(schema.creators, eq(schema.creators.id, schema.outreach.creatorId))
    .where(eq(schema.outreach.id, String(draft.meta.outreachId ?? "")));
  if (!row) throw new OpsError("The outreach record for this draft is missing");
  if (row.c.doNotContact) throw new OpsError(`${row.c.name} is marked do-not-contact — don't send this.`);
  if (row.o.stage === "declined") throw new OpsError(`${row.c.name} declined — don't send this. Move the outreach out of “declined” first if that's wrong.`);
}

/** When a creator opts out: pull every unsent outreach draft to them out of the queue (status rejected, with a note). */
async function withdrawOutreachDrafts(creatorId: string, actor: string) {
  const db = await getDb();
  const outs = await db.select({ id: schema.outreach.id }).from(schema.outreach).where(eq(schema.outreach.creatorId, creatorId));
  if (outs.length === 0) return;
  const rows = await db.update(schema.drafts)
    .set({ status: "rejected", reviewedBy: actor, reviewedAt: new Date(), reviewNote: "Creator is do-not-contact — don't send or revise this.", updatedAt: new Date() })
    .where(and(
      inArray(schema.drafts.kind, ["outreach_email", "outreach_dm"]),
      inArray(schema.drafts.status, ["needs_review", "approved", "failed"]),
      inArray(sql`${schema.drafts.meta}->>'outreachId'`, outs.map((o) => o.id)),
    )).returning({ id: schema.drafts.id, title: schema.drafts.title, clientId: schema.drafts.clientId });
  for (const r of rows)
    await logActivity({ actor, action: "draft.withdrawn", entityType: "draft", entityId: r.id, clientId: r.clientId, summary: `Withdrew “${r.title}” — creator is do-not-contact` });
}

/** After a manual send (or a successful API send): record downstream effects. Idempotent. */
export async function markDraftSent(id: string, actor: string, extra: { threadId?: string; permalink?: string; sentByApi?: boolean } = {}) {
  if (actor === "claude") throw new OpsError("Only a person can mark something as sent");
  const db = await getDb();
  const [cur] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, id));
  if (!cur) throw new OpsError("draft not found");
  if (cur.status === "approved" && (cur.kind === "outreach_email" || cur.kind === "outreach_dm") && !extra.sentByApi) await assertContactable(cur);
  const [draft] = await db.update(schema.drafts).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.drafts.id, id), eq(schema.drafts.status, "approved"))).returning();
  if (!draft) return;
  const now = new Date();
  if (draft.kind === "review_reply") {
    await db.update(schema.reviews).set({ replyText: draft.body }).where(eq(schema.reviews.id, String(draft.meta.reviewId)));
  }
  if (draft.kind === "outreach_email" || draft.kind === "outreach_dm") {
    const [o] = await db.select().from(schema.outreach).where(eq(schema.outreach.id, String(draft.meta.outreachId)));
    if (o) {
      const first = !o.contactedAt;
      const early = ["sourced", "shortlisted", "contacted", "followed_up", "no_response"].includes(o.stage);
      await db.update(schema.outreach).set({
        stage: early ? (first ? "contacted" : "followed_up") : o.stage,
        contactedAt: o.contactedAt ?? now,
        lastActivityAt: now,
        nextFollowUpAt: early ? new Date(now.getTime() + 5 * 86400_000) : o.nextFollowUpAt,
        ...(extra.threadId ? { gmailThreadId: extra.threadId } : {}),
      }).where(eq(schema.outreach.id, o.id));
    }
  }
  if (draft.taskId) await updateTask(draft.taskId, { status: "done" }, actor);
  await logActivity({ actor, action: "draft.sent", entityType: "draft", entityId: id, clientId: draft.clientId, summary: `Sent “${draft.title}”${extra.permalink ? ` (${extra.permalink})` : ""}` });
}

/* ───────────────────────── Creators & outreach ───────────────────────── */

export const CreatorInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  instagramHandle: z.string().nullish(),
  tiktokHandle: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal("")),
  city: z.string().nullish(),
  niche: z.string().nullish(),
  instagramFollowers: z.coerce.number().int().nonnegative().nullish(),
  tiktokFollowers: z.coerce.number().int().nonnegative().nullish(),
  engagementRate: z.coerce.number().nonnegative().nullish(),
  doNotContact: z.boolean().optional(),
  notes: z.string().nullish(),
  source: z.string().nullish(),
});

/** Creates or updates a creator; de-dupes on IG handle, TikTok handle, or email. */
export async function upsertCreator(input: z.input<typeof CreatorInput>, actor: string) {
  const v = CreatorInput.parse(input);
  const db = await getDb();
  const ig = handle(v.instagramHandle), tt = handle(v.tiktokHandle), email = d(v.email)?.toLowerCase() ?? null;
  let existing: schema.Creator | undefined;
  if (v.id) [existing] = await db.select().from(schema.creators).where(eq(schema.creators.id, v.id));
  if (!existing && ig) [existing] = await db.select().from(schema.creators).where(eq(schema.creators.instagramHandle, ig));
  if (!existing && tt) [existing] = await db.select().from(schema.creators).where(eq(schema.creators.tiktokHandle, tt));
  if (!existing && email) [existing] = await db.select().from(schema.creators).where(eq(schema.creators.email, email));
  const statsTouched = v.instagramFollowers != null || v.tiktokFollowers != null || v.engagementRate != null;
  const values = {
    name: v.name.trim(),
    ...(ig || !existing ? { instagramHandle: ig ?? existing?.instagramHandle ?? null } : {}),
    ...(tt || !existing ? { tiktokHandle: tt ?? existing?.tiktokHandle ?? null } : {}),
    ...(email || !existing ? { email: email ?? existing?.email ?? null } : {}),
    ...(v.city !== undefined ? { city: d(v.city) } : {}),
    ...(v.niche !== undefined ? { niche: d(v.niche) } : {}),
    ...(v.instagramFollowers != null ? { instagramFollowers: v.instagramFollowers } : {}),
    ...(v.tiktokFollowers != null ? { tiktokFollowers: v.tiktokFollowers } : {}),
    ...(v.engagementRate != null ? { engagementRate: v.engagementRate } : {}),
    ...(statsTouched ? { statsUpdatedAt: new Date() } : {}),
    ...(v.doNotContact !== undefined ? { doNotContact: v.doNotContact } : {}),
    ...(v.notes !== undefined ? { notes: d(v.notes) } : {}),
    ...(v.source !== undefined ? { source: d(v.source) } : {}),
  };
  if (existing) {
    await db.update(schema.creators).set(values).where(eq(schema.creators.id, existing.id));
    await logActivity({ actor, action: "creator.updated", entityType: "creator", entityId: existing.id, summary: `Updated creator ${v.name}` });
    if (v.doNotContact === true) await withdrawOutreachDrafts(existing.id, actor);
    return existing.id;
  }
  const id = newId("cr_");
  await db.insert(schema.creators).values({ id, ...values });
  await logActivity({ actor, action: "creator.created", entityType: "creator", entityId: id, summary: `Added creator ${v.name}` });
  return id;
}

export const OutreachInput = z.object({
  clientId: z.string(),
  creatorId: z.string(),
  channel: z.enum(schema.OUTREACH_CHANNELS),
  stage: z.enum(schema.OUTREACH_STAGES).optional(),
  compType: z.enum(["gifted", "paid", "affiliate", "tbd"]).optional(),
  notes: z.string().nullish(),
  postUrl: z.string().nullish(),
  disclosureOk: z.boolean().nullish(),
  nextFollowUpAt: z.coerce.date().nullish(),
});

/** One relationship per (business, creator). Stage changes bump lastActivityAt. */
export async function upsertOutreach(input: z.input<typeof OutreachInput>, actor: string) {
  const v = OutreachInput.parse(input);
  const db = await getDb();
  const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.id, v.creatorId));
  if (!creator) throw new OpsError("creator not found");
  const [existing] = await db.select().from(schema.outreach).where(and(eq(schema.outreach.clientId, v.clientId), eq(schema.outreach.creatorId, v.creatorId)));
  const now = new Date();
  const contacting = v.stage && ["contacted", "followed_up"].includes(v.stage);
  if (creator.doNotContact && contacting) throw new OpsError(`${creator.name} is marked do-not-contact`);
  if (existing) {
    const set: Partial<typeof schema.outreach.$inferInsert> = { channel: v.channel };
    if (v.stage) { set.stage = v.stage; set.lastActivityAt = now; if (contacting && !existing.contactedAt) set.contactedAt = now; }
    if (v.compType) set.compType = v.compType;
    if (v.notes !== undefined) set.notes = d(v.notes);
    if (v.postUrl !== undefined) set.postUrl = d(v.postUrl);
    if (v.disclosureOk !== undefined) set.disclosureOk = v.disclosureOk;
    if (v.nextFollowUpAt !== undefined) set.nextFollowUpAt = v.nextFollowUpAt;
    await db.update(schema.outreach).set(set).where(eq(schema.outreach.id, existing.id));
    await logActivity({ actor, action: "outreach.updated", entityType: "outreach", entityId: existing.id, clientId: v.clientId, summary: `${creator.name}: ${v.stage ? `→ ${v.stage.replace("_", " ")}` : "updated"}` });
    return existing.id;
  }
  const id = newId("out_");
  await db.insert(schema.outreach).values({
    id, clientId: v.clientId, creatorId: v.creatorId, channel: v.channel, stage: v.stage ?? "sourced", compType: v.compType ?? "tbd",
    notes: d(v.notes), postUrl: d(v.postUrl), disclosureOk: v.disclosureOk ?? null, nextFollowUpAt: v.nextFollowUpAt ?? null,
    contactedAt: contacting ? now : null, lastActivityAt: now,
  });
  await logActivity({ actor, action: "outreach.created", entityType: "outreach", entityId: id, clientId: v.clientId, summary: `${creator.name} added to outreach (${v.channel.replace("_", " ")})` });
  return id;
}

/* ───────────────────────── Monthly metrics ───────────────────────── */

export const MetricInput = z.object({
  clientId: z.string(),
  month: z.string().refine(isMonth, "month must be YYYY-MM"),
  platform: z.enum(["instagram", "tiktok", "google"]),
  views: z.coerce.number().int().nonnegative().nullish(),
  reach: z.coerce.number().int().nonnegative().nullish(),
  followers: z.coerce.number().int().nonnegative().nullish(),
  engagements: z.coerce.number().int().nonnegative().nullish(),
  source: z.enum(["manual", "api"]).default("manual"),
});

export async function upsertMetric(input: z.input<typeof MetricInput>, actor: string) {
  const v = MetricInput.parse(input);
  const db = await getDb();
  const vals = { views: v.views ?? null, reach: v.reach ?? null, followers: v.followers ?? null, engagements: v.engagements ?? null, source: v.source, updatedAt: new Date() };
  await db.insert(schema.monthlyMetrics).values({ id: newId("met_"), clientId: v.clientId, month: v.month, platform: v.platform, ...vals })
    .onConflictDoUpdate({ target: [schema.monthlyMetrics.clientId, schema.monthlyMetrics.month, schema.monthlyMetrics.platform], set: vals });
  if (v.source === "manual") await logActivity({ actor, action: "metric.updated", entityType: "metric", entityId: `${v.clientId}:${v.month}:${v.platform}`, clientId: v.clientId, summary: `${v.platform} ${v.month}: ${v.views ?? "—"} views` });
}

/* ───────────────────────── Google reviews (sync) ───────────────────────── */

export async function upsertReviews(rows: Array<Omit<typeof schema.reviews.$inferInsert, "syncedAt">>) {
  const db = await getDb();
  for (const r of rows) {
    const { id: _id, ...rest } = r;
    await db.insert(schema.reviews).values({ ...r, syncedAt: new Date() })
      .onConflictDoUpdate({ target: schema.reviews.id, set: { ...rest, syncedAt: new Date() } });
  }
}

/* ───────────────────────── Monthly checklist ───────────────────────── */

/**
 * Turns a client's monthly plan into concrete tasks for `month`, topping up to each deliverable's target.
 * Idempotent: re-running only adds what's missing. targetPerMonth 0 ("as needed") yields one umbrella task.
 */
export async function generateMonthTasks(clientId: string, month: string, actor: string) {
  if (!isMonth(month)) throw new OpsError("month must be YYYY-MM");
  const db = await getDb();
  const dels = await db.select().from(schema.deliverables)
    .where(and(eq(schema.deliverables.clientId, clientId), eq(schema.deliverables.active, true)));
  let created = 0;
  for (const dl of dels) {
    const want = Math.max(1, dl.targetPerMonth);
    const existing = await db.select({ id: schema.tasks.id, title: schema.tasks.title }).from(schema.tasks)
      .where(and(eq(schema.tasks.deliverableId, dl.id), eq(schema.tasks.month, month)));
    if (existing.length >= want) continue;
    // Each slot has a deterministic id, so two concurrent runs (or a double-submit) pick the same ids for the same
    // gaps and the primary key makes the second insert a no-op instead of a duplicate.
    const ids = new Set(existing.map((t) => t.id));
    const titles = new Set(existing.map((t) => t.title));
    const titleFor = (i: number) => (dl.targetPerMonth === 0 ? `${dl.title} (all, as they come in)` : `${dl.title} — ${i + 1} of ${dl.targetPerMonth}`);
    const rows: Array<typeof schema.tasks.$inferInsert> = [];
    for (let i = 0; rows.length < want - existing.length && i < want + 2 * existing.length; i++) {
      const id = `tsk_gen_${dl.id}_${month}_${i}`;
      if (ids.has(id) || titles.has(titleFor(i))) continue;
      rows.push({ id, clientId, month, deliverableId: dl.id, platform: dl.platform, createdBy: actor, title: titleFor(i) });
    }
    if (rows.length === 0) continue;
    const inserted = await db.insert(schema.tasks).values(rows).onConflictDoNothing({ target: schema.tasks.id }).returning({ id: schema.tasks.id });
    created += inserted.length;
  }
  if (created) await logActivity({ actor, action: "tasks.generated", entityType: "client", entityId: clientId, clientId, summary: `Created ${created} checklist task${created === 1 ? "" : "s"} for ${month}` });
  return created;
}

/* ───────────────────────── Creators: explicit edits ───────────────────────── */

/**
 * Edits one known creator. Unlike upsertCreator (merge-only, used for imports/research), a field passed as
 * null or "" is cleared here; fields left undefined are untouched. Refuses handles/emails another creator has.
 */
export async function updateCreator(id: string, input: Omit<Partial<z.input<typeof CreatorInput>>, "id">, actor: string) {
  const v = CreatorInput.omit({ id: true }).partial().parse(input);
  const db = await getDb();
  const [cur] = await db.select().from(schema.creators).where(eq(schema.creators.id, id));
  if (!cur) throw new OpsError("creator not found");
  const set: Partial<typeof schema.creators.$inferInsert> = {};
  if (v.name !== undefined) set.name = v.name.trim();
  if (v.instagramHandle !== undefined) set.instagramHandle = handle(v.instagramHandle);
  if (v.tiktokHandle !== undefined) set.tiktokHandle = handle(v.tiktokHandle);
  if (v.email !== undefined) set.email = d(v.email)?.toLowerCase() ?? null;
  const dupes: Array<[keyof typeof set, string]> = [["instagramHandle", "Instagram handle"], ["tiktokHandle", "TikTok handle"], ["email", "email"]];
  for (const [key, label] of dupes) {
    const val = set[key];
    if (typeof val !== "string" || val === cur[key as keyof schema.Creator]) continue;
    const col = schema.creators[key as "instagramHandle" | "tiktokHandle" | "email"];
    const [other] = await db.select({ id: schema.creators.id, name: schema.creators.name }).from(schema.creators).where(eq(col, val));
    if (other && other.id !== id) throw new OpsError(`${other.name} already has that ${label}`);
  }
  if (v.city !== undefined) set.city = d(v.city);
  if (v.niche !== undefined) set.niche = d(v.niche);
  if (v.notes !== undefined) set.notes = d(v.notes);
  if (v.source !== undefined) set.source = d(v.source);
  if (v.doNotContact !== undefined) set.doNotContact = v.doNotContact;
  let statsChanged = false;
  if (v.instagramFollowers !== undefined && (v.instagramFollowers ?? null) !== cur.instagramFollowers) { set.instagramFollowers = v.instagramFollowers ?? null; statsChanged = true; }
  if (v.tiktokFollowers !== undefined && (v.tiktokFollowers ?? null) !== cur.tiktokFollowers) { set.tiktokFollowers = v.tiktokFollowers ?? null; statsChanged = true; }
  if (v.engagementRate !== undefined && (v.engagementRate ?? null) !== cur.engagementRate) { set.engagementRate = v.engagementRate ?? null; statsChanged = true; }
  if (statsChanged) set.statsUpdatedAt = new Date();
  if (Object.keys(set).length === 0) return id;
  await db.update(schema.creators).set(set).where(eq(schema.creators.id, id));
  const name = set.name ?? cur.name;
  const summary = v.doNotContact !== undefined && v.doNotContact !== cur.doNotContact
    ? `${name} ${v.doNotContact ? "marked do-not-contact" : "cleared from do-not-contact"}`
    : `Updated creator ${name}`;
  await logActivity({ actor, action: v.doNotContact !== undefined && v.doNotContact !== cur.doNotContact ? "creator.do_not_contact" : "creator.updated", entityType: "creator", entityId: id, summary });
  if (v.doNotContact === true) await withdrawOutreachDrafts(id, actor);
  return id;
}

/* ───────────────────────── Third-party connections ───────────────────────── */

export const ConnectionInput = z.object({
  provider: z.enum(schema.PROVIDERS),
  clientId: z.string().nullish(), // null = shared (Google Business, Gmail outreach inbox)
  label: z.string().min(1),
  externalId: z.string().min(1),
  tokens: z.record(z.string(), z.unknown()),
  scopes: z.string().nullish(),
  expiresAt: z.coerce.date().nullish(),
});

/**
 * Stores (or replaces) an OAuth connection after a successful sign-in. Tokens are encrypted here and never
 * leave the server. One connection per (provider, business): connecting a different account for the same
 * business — or for a shared provider — replaces the old one.
 */
export async function saveConnection(input: z.input<typeof ConnectionInput>, actor: string) {
  const v = ConnectionInput.parse(input);
  const { encryptJson } = await import("./crypto");
  const db = await getDb();
  const clientId = v.clientId || null;
  const tokenEnc = encryptJson(v.tokens);
  const now = new Date();
  const vals = { clientId, label: v.label.trim(), tokenEnc, scopes: d(v.scopes), expiresAt: v.expiresAt ?? null, status: "ok" as const, lastError: null, updatedAt: now };
  const [row] = await db.insert(schema.connections).values({ id: newId("con_"), provider: v.provider, externalId: v.externalId, ...vals })
    .onConflictDoUpdate({ target: [schema.connections.provider, schema.connections.externalId], set: vals }).returning();
  // Drop any other account previously connected for the same slot.
  await db.delete(schema.connections).where(and(
    eq(schema.connections.provider, v.provider),
    sql`${schema.connections.id} <> ${row.id}`,
    clientId ? eq(schema.connections.clientId, clientId) : sql`${schema.connections.clientId} is null`,
  ));
  await logActivity({ actor, action: "connection.connected", entityType: "connection", entityId: row.id, clientId, summary: `Connected ${v.provider === "gmail" ? "Gmail" : v.provider === "google" ? "Google Business Profile" : v.provider === "instagram" ? "Instagram" : v.provider}: ${vals.label}` });
  return row.id;
}

/** Routine token refresh (cron / on-demand). Not logged — it happens constantly and isn't a human decision. */
export async function updateConnectionTokens(id: string, patch: { tokens: Record<string, unknown>; expiresAt?: Date | null }) {
  const { encryptJson } = await import("./crypto");
  const db = await getDb();
  const set: Partial<typeof schema.connections.$inferInsert> = { tokenEnc: encryptJson(patch.tokens), status: "ok", lastError: null, updatedAt: new Date() };
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
  await db.update(schema.connections).set(set).where(eq(schema.connections.id, id));
}

/** Records a connection problem (or recovery). Logs only when the status actually changes. */
export async function setConnectionStatus(id: string, status: "ok" | "error" | "expired", lastError: string | null, actor = "system") {
  if (!["ok", "error", "expired"].includes(status)) throw new OpsError(`bad status ${status}`);
  const db = await getDb();
  const [cur] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
  if (!cur) return;
  const err = lastError ? lastError.slice(0, 500) : null;
  if (cur.status === status && cur.lastError === err) return;
  await db.update(schema.connections).set({ status, lastError: err, updatedAt: new Date() }).where(eq(schema.connections.id, id));
  if (cur.status !== status) {
    await logActivity({ actor, action: `connection.${status}`, entityType: "connection", entityId: id, clientId: cur.clientId, summary: status === "ok" ? `${cur.label} connection is working again` : `${cur.label} connection ${status === "expired" ? "expired" : "has a problem"}${err ? `: ${err}` : ""}` });
  }
}

export async function deleteConnection(id: string, actor: string) {
  if (actor === "claude") throw new OpsError("Only a person can disconnect an account");
  const db = await getDb();
  const [row] = await db.delete(schema.connections).where(eq(schema.connections.id, id)).returning();
  if (row) await logActivity({ actor, action: "connection.disconnected", entityType: "connection", entityId: id, clientId: row.clientId, summary: `Disconnected ${row.provider}: ${row.label}` });
}

/* ───────────────────────── Ask conversation ───────────────────────── */

export const AskMessageInput = z.object({
  askId: z.string().min(1),
  body: z.string().trim().min(1, "Write something first.").max(4000, "Keep it under 4000 characters."),
});

const isClaude = (author: string | null | undefined) => author?.toLowerCase() === "claude";

/**
 * Adds a message to an ask's thread (a question/update from Claude, or an answer from a person)
 * and bumps asks.updatedAt.
 *
 * Hand-back rule: when a PERSON replies to an ask that is in_progress, and the last thing in the
 * thread before this reply was Claude's (its latest message, or — if there are no messages yet —
 * its claudeNote), Claude asked a question and is waiting. The ask goes back to "new" so it shows up
 * in Claude's next get_briefing. Anything else (Claude posting, a person adding a second note,
 * replies on new/done/archived asks) leaves the status alone.
 */
export async function addAskMessage(askId: string, body: string, actor: string) {
  const v = AskMessageInput.parse({ askId, body });
  const db = await getDb();
  const [ask] = await db.select().from(schema.asks).where(eq(schema.asks.id, v.askId));
  if (!ask) throw new OpsError(`ask ${v.askId} not found`);

  const [prev] = await db.select({ author: schema.askMessages.author }).from(schema.askMessages)
    .where(eq(schema.askMessages.askId, ask.id)).orderBy(desc(schema.askMessages.createdAt)).limit(1);
  const claudeWasLast = prev ? isClaude(prev.author) : !!ask.claudeNote;
  const fromClaude = isClaude(actor);
  const handBack = !fromClaude && ask.status === "in_progress" && claudeWasLast;

  const id = newId("msg_");
  const now = new Date();
  await db.insert(schema.askMessages).values({ id, askId: ask.id, author: fromClaude ? "claude" : actor, body: v.body, createdAt: now });
  await db.update(schema.asks).set({ updatedAt: now, ...(handBack ? { status: "new" as const } : {}) }).where(eq(schema.asks.id, ask.id));

  const snippet = v.body.length > 80 ? `${v.body.slice(0, 80)}…` : v.body;
  await logActivity({
    actor,
    action: "ask.message",
    entityType: "ask",
    entityId: ask.id,
    clientId: ask.clientId,
    summary: fromClaude ? `Claude on an ask: ${snippet}` : `Replied on an ask${handBack ? " (back to Claude)" : ""}: ${snippet}`,
  });
  return { id, status: handBack ? ("new" as const) : ask.status, handedBack: handBack };
}

/** One ask's thread, oldest first. */
export async function listAskMessages(askId: string) {
  const db = await getDb();
  return db.select().from(schema.askMessages).where(eq(schema.askMessages.askId, askId)).orderBy(asc(schema.askMessages.createdAt));
}

/** Threads for many asks at once (oldest first per ask). */
export async function listAskMessagesFor(askIds: string[]) {
  const out = new Map<string, schema.AskMessage[]>();
  if (!askIds.length) return out;
  const db = await getDb();
  const rows = await db.select().from(schema.askMessages).where(inArray(schema.askMessages.askId, askIds)).orderBy(asc(schema.askMessages.createdAt));
  for (const r of rows) out.set(r.askId, [...(out.get(r.askId) ?? []), r]);
  return out;
}

/**
 * Where the conversation stands, from the latest message (or Claude's note when there are none):
 *  - "claude_asked": Claude spoke last and the ask is waiting (in_progress) — Nora should answer.
 *  - "replied": a person answered after Claude — Claude should pick it up.
 *  - null: nothing pending in the thread.
 */
export type AskThreadState = "claude_asked" | "replied" | null;
export function askThreadState(ask: Pick<schema.Ask, "status" | "claudeNote">, last: Pick<schema.AskMessage, "author"> | null | undefined, claudeSpoke = !!ask.claudeNote): AskThreadState {
  if (ask.status === "archived") return null;
  if (last ? isClaude(last.author) : !!ask.claudeNote) return ask.status === "in_progress" ? "claude_asked" : null;
  if (last && claudeSpoke && ask.status !== "done") return "replied";
  return null;
}
