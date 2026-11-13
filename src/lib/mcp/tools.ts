import "server-only";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getDb, schema } from "@/lib/db";
import { getClientMonth } from "@/lib/reports";
import { addMonths, currentMonth, isMonth } from "@/lib/dates";
import {
  OpsError,
  addAskMessage,
  createDraft,
  createPost,
  createTask,
  generateMonthTasks,
  reviseDraft,
  updateAsk,
  updatePost,
  updateTask,
  upsertCreator,
  upsertMetric,
  upsertOutreach,
} from "@/lib/ops";
import { TASK_SCOPES } from "@/lib/ops-tasks";
import { WORKING_RULES } from "./rules";
import { checkPitch, draftLeadPitch } from "./tools-leads";
import {
  businessName,
  clientNames,
  findClient,
  getBriefingData,
  getMonthlyReport,
  listAsks,
  listCalendar,
  listDrafts,
  listFollowUpsDue,
  listReviews,
  listTasks,
  pendingDraftsFor,
  searchCreators,
  shapeAsk,
  shapeCreator,
  shapeDraft,
  shapeOutreach,
  shapePost,
  shapeTask,
  threadsFor,
  type Ctx,
} from "./queries";

/**
 * The tools Claude gets through the Nora HQ connector.
 * Every write goes through lib/ops.ts with actor "claude". There are deliberately NO tools to approve,
 * reject, mark sent, schedule, publish or send — those stay with Cameron and Nora in the app.
 */

const ACTOR = "claude";

/* ───────────── result helpers ───────────── */

class ToolError extends Error {}

/** JSON without nulls/undefined to keep responses compact. */
function compactJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (v === null || v === undefined ? undefined : v));
}

function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return `Invalid input — ${e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
  if (e instanceof ToolError || e instanceof OpsError) return e.message;
  console.error("[mcp] tool error", e);
  return `Something went wrong in Nora HQ: ${e instanceof Error ? e.message : String(e)}`;
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: compactJson(data) }] };
  } catch (e) {
    return { content: [{ type: "text", text: errorMessage(e) }], isError: true };
  }
}

async function requireClient(id: string) {
  const c = await findClient(id);
  if (!c) throw new ToolError(`No business with id "${id}". Call list_clients for valid ids.`);
  return c;
}

function monthOrCurrent(m: string | undefined): string {
  if (m === undefined) return currentMonth();
  if (!isMonth(m)) throw new ToolError(`month must be YYYY-MM (got "${m}")`);
  return m;
}

/* ───────────── content checks ───────────── */

const HASHTAG = /#[\p{L}\p{N}_]+/gu;

function checkCaption(platform: "instagram" | "tiktok", caption: string, warnings: string[]) {
  if (caption.length > 2200) throw new ToolError(`Caption is ${caption.length} characters; the limit is 2200. Shorten it.`);
  const tags = caption.match(HASHTAG)?.length ?? 0;
  if (tags > 30) throw new ToolError(`Caption has ${tags} hashtags; Instagram allows at most 30 (aim for 3–8).`);
  if (tags > 8) warnings.push(`${tags} hashtags — the house style is 3–8.`);
  if (platform === "tiktok" && caption.length > 300) warnings.push("TikTok captions should be short (one or two lines plus a few hashtags).");
}

const REVIEW_SOLICITATION = /\b(google|yelp|tripadvisor)\b[^.!?\n]{0,60}\breview|\breview[^.!?\n]{0,40}\b(google|yelp|tripadvisor)\b/i;

function checkReviewReply(body: string, warnings: string[]) {
  const words = body.trim().split(/\s+/).length;
  if (words > 120) throw new ToolError(`Review reply is ${words} words; keep it under about 80.`);
  if (words > 85) warnings.push(`Reply is ${words} words; aim for under about 80.`);
  if (/\b(discount|coupon|voucher|% off|free (meal|item|dessert|drink|appetizer))\b/i.test(body))
    warnings.push("Reply mentions a discount/freebie — never offer incentives in review replies unless Nora explicitly asked to make something right.");
  if (/\b(change|update|remove|delete|edit)\b[^.!?\n]{0,30}\b(rating|review|stars?)\b/i.test(body))
    throw new ToolError("Never ask a reviewer to change, update or remove their rating/review. Rewrite the reply.");
}

function checkOutreach(body: string, warnings: string[]) {
  if (REVIEW_SOLICITATION.test(body)) throw new ToolError("Outreach must never ask creators for Google/Yelp/TripAdvisor reviews. Remove that line.");
  if (!/#ad\b|gifted/i.test(body)) warnings.push('No FTC disclosure found — first-contact messages should include: "If you post, please tag it as gifted/#ad".');
}

function profileUrl(channel: string, c: schema.Creator): string | undefined {
  if (channel === "instagram_dm" && c.instagramHandle) return `https://www.instagram.com/${c.instagramHandle}/`;
  if (channel === "tiktok_dm" && c.tiktokHandle) return `https://www.tiktok.com/@${c.tiktokHandle}`;
  return undefined;
}

const POST_FORMATS_BY_PLATFORM = {
  instagram: ["feed", "reel", "carousel", "story"],
  tiktok: ["video", "carousel"],
} as const;

function checkFormat(platform: "instagram" | "tiktok", format: unknown) {
  if (format === undefined || format === null) return;
  if (!(POST_FORMATS_BY_PLATFORM[platform] as readonly string[]).includes(String(format)))
    throw new ToolError(`format for ${platform} must be one of: ${POST_FORMATS_BY_PLATFORM[platform].join(", ")}`);
}

function checkSchedule(value: unknown, warnings: string[]): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new ToolError("scheduledFor must be an ISO 8601 date-time, e.g. 2026-11-14T17:30:00-05:00");
  if (d.getTime() < Date.now()) warnings.push("scheduledFor is in the past — a person will need to pick a new time.");
  return d.toISOString();
}

function checkMediaUrls(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const parsed = z.array(z.string().url()).safeParse(value);
  if (!parsed.success) throw new ToolError("mediaUrls must be an array of absolute https URLs (use the attachment URLs from the ask).");
  return parsed.data;
}

function duplicateMessage(what: string, d: { id: string; status: string }): string {
  return d.status === "approved"
    ? `${what} already has an approved draft (${d.id}) waiting for a person to send/post it. Don't write another.`
    : `${what} already has draft ${d.id} (${d.status}). Use revise_draft on it instead of creating a new one.`;
}

const EDITABLE_POST: schema.PostStatus[] = ["idea", "drafted"];

async function getPost(id: string) {
  const db = await getDb();
  const [p] = await db.select().from(schema.contentPosts).where(eq(schema.contentPosts.id, id));
  if (!p) throw new ToolError(`No calendar post with id "${id}".`);
  return p;
}

async function getCreator(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.creators).where(eq(schema.creators.id, id));
  if (!c) throw new ToolError(`No creator with id "${id}". Use search_creators or upsert_creator.`);
  return c;
}

/* ───────────── shared schemas ───────────── */

const clientId = z.string().describe("Business id from list_clients, e.g. \"poke-bros\".");
const monthArg = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM").describe("Month as YYYY-MM.");
const limit = (def: number, max = 100) => z.number().int().min(1).max(max).default(def).describe(`Max rows (default ${def}).`);
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/* ───────────── registration ───────────── */

export function registerTools(server: McpServer, ctx: Ctx) {
  /* ── Orientation ── */

  server.registerTool("get_briefing", {
    title: "Get briefing (start here)",
    description:
      "START HERE every session. Returns today's date and month, the working rules you must follow, NEW asks from Nora (full text + attachment URLs + business + conversation thread), " +
      "drafts a person SENT BACK with a review note (revise these first with revise_draft), open tasks assigned to Claude or unassigned that are due within 7 days " +
      "(or undated for this month or earlier), creator follow-ups that are due, asks still waiting on Nora's answers, and a per-business summary for the month " +
      "Each ask has `thread` (messages between you and Nora/Cameron, oldest first) and `needsYourReply` — true when a person answered after you; " +
      "an ask you asked a question on comes back as NEW once Nora answers, so read its thread before working it. " +
      "(plan progress, open/overdue tasks, drafts awaiting review, unreplied Google reviews, whether this month's tasks and metrics exist). " +
      "Each business has a kind (business or creator); kind \"creator\" (id \"noraeatsgood\") is Nora's own content-creator workspace (her @noraeatsgood content, stats and collab inbox), not a managed business: file her own content work under it, and don't treat it like a client (no Google mapping, business brand voice or client pitches). " +
      "Suggested order: sent-back drafts → asks with needsYourReply → other new asks → due tasks → follow-ups → unreplied reviews. Finish by calling update_ask on every ask you touched.",
    inputSchema: {},
    annotations: READ,
  }, async () => run(async () => ({ rules: WORKING_RULES, ...(await getBriefingData(ctx)) })));

  server.registerTool("list_clients", {
    title: "List businesses",
    description:
      "Lists the businesses we manage with their ids, location, Instagram/TikTok handles, website, brand voice, notes, creator search areas (outreachAreas: where to look for local creators, e.g. \"Richmond, 757 / Hampton Roads\") and monthly plan (deliverables with target per month; 0 = as needed; platform facebook = Facebook Page posts, posted by hand). " +
      "Use the id as client_id in other tools. Always read brandVoice before drafting anything for a business. " +
      "kind \"creator\" (id \"noraeatsgood\") is Nora's own content-creator workspace (her @noraeatsgood content, stats and collab inbox), not a managed business: file her own content work under it, and don't treat it like a client (no Google mapping, business brand voice or client pitches). ",
    inputSchema: { include_archived: z.boolean().default(false).describe("Include archived businesses.") },
    annotations: READ,
  }, async ({ include_archived }) => run(async () => {
    const db = await getDb();
    const [clients, dels] = await Promise.all([
      db.select().from(schema.clients).where(include_archived ? undefined : eq(schema.clients.archived, false)).orderBy(asc(schema.clients.sortOrder), asc(schema.clients.name)),
      db.select().from(schema.deliverables).where(eq(schema.deliverables.active, true)).orderBy(asc(schema.deliverables.sortOrder)),
    ]);
    return clients.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: businessName(c),
      brand: c.brand,
      instagramHandle: c.instagramHandle,
      tiktokHandle: c.tiktokHandle,
      website: c.website,
      googleConnected: !!c.googleLocation,
      brandVoice: c.brandVoice,
      notes: c.notes,
      outreachAreas: c.outreachAreas,
      archived: c.archived || undefined,
      monthlyPlan: dels.filter((d) => d.clientId === c.id).map((d) => ({ deliverableId: d.id, title: d.title, platform: d.platform, targetPerMonth: d.targetPerMonth })),
    }));
  }));

  server.registerTool("get_client_month", {
    title: "Get a business's month",
    description:
      "Everything about one business for one month: brand voice and notes, monthly plan progress (done vs target per deliverable), this month's checklist tasks, " +
      "outstanding tasks (not done, this month or earlier), creator outreach with each creator, 12-month metrics (views = impressions, reach, followers, engagements per platform), " +
      "calendar posts scheduled in the month, and counts of unreplied reviews and drafts awaiting review. Read this before drafting for a business. " +
      "business.kind \"creator\" (id \"noraeatsgood\") is Nora's own content-creator workspace (her @noraeatsgood content, stats and collab inbox), not a managed business: file her own content work under it, and don't treat it like a client (no Google mapping, business brand voice or client pitches). ",
    inputSchema: { client_id: clientId, month: monthArg.optional().describe("YYYY-MM; defaults to the current month.") },
    annotations: READ,
  }, async ({ client_id, month }) => run(async () => {
    const m = monthOrCurrent(month);
    const cm = await getClientMonth(client_id, m);
    if (!cm) throw new ToolError(`No business with id "${client_id}". Call list_clients for valid ids.`);
    const names = await clientNames();
    return {
      business: { id: cm.client.id, kind: cm.client.kind, name: businessName(cm.client), instagramHandle: cm.client.instagramHandle, tiktokHandle: cm.client.tiktokHandle, website: cm.client.website, googleConnected: !!cm.client.googleLocation, brandVoice: cm.client.brandVoice, notes: cm.client.notes, outreachAreas: cm.client.outreachAreas },
      month: cm.month,
      plan: cm.plan.map((p) => ({ deliverableId: p.deliverable.id, title: p.deliverable.title, platform: p.deliverable.platform, target: p.target || "as needed", done: p.done, tasksPlanned: p.planned })),
      monthTasks: cm.monthTasks.map((t) => shapeTask(t, names)),
      outstandingTasks: cm.openTasks.map((t) => shapeTask(t, names)),
      outreach: cm.outreach.map((o) => ({ ...shapeOutreach(o, names), creator: shapeCreator(o.creator) })),
      creatorsContactedThisMonth: cm.contactedThisMonth,
      metrics: cm.metrics.filter((s) => s.instagram || s.tiktok || s.google).map((s) => ({
        month: s.month,
        ...Object.fromEntries((["instagram", "tiktok", "google"] as const).filter((p) => s[p]).map((p) => [p, { views: s[p]!.views, reach: s[p]!.reach, followers: s[p]!.followers, engagements: s[p]!.engagements, source: s[p]!.source }])),
      })),
      posts: cm.posts.map(shapePost),
      unrepliedReviews: cm.unrepliedReviews,
      draftsAwaitingReview: cm.pendingDrafts,
    };
  }));

  /* ── Asks ── */

  server.registerTool("list_asks", {
    title: "List asks",
    description:
      "Lists asks — free-form requests Nora or Cameron dropped in the app (e.g. \"write 3 captions for these photos\", \"find 10 Richmond food creators\", \"here are October's numbers\"). " +
      "Default status \"open\" = new + in_progress. Attachment URLs are photos/videos you can reference or pass as mediaUrls on post drafts. " +
      "Each ask includes its conversation `thread` (oldest first) and `needsYourReply` (a person wrote after you).",
    inputSchema: {
      status: z.enum(["open", ...schema.ASK_STATUSES]).default("open").describe("open (new + in_progress), new, in_progress, done or archived."),
      client_id: clientId.optional(),
      limit: limit(30),
    },
    annotations: READ,
  }, async ({ status, client_id, limit }) => run(async () => {
    const names = await clientNames();
    const rows = await listAsks({ status, clientId: client_id, limit });
    const threads = await threadsFor(rows);
    return rows.map((a) => shapeAsk(a, names, ctx, threads.get(a.id) ?? []));
  }));

  server.registerTool("reply_to_ask", {
    title: "Reply on an ask",
    description:
      "Adds a message to an ask's conversation, shown to Nora in the app as a chat bubble from Claude. Use it to ask questions when an ask is unclear " +
      "(list them plainly, numbered if more than one) or to post a short progress update. Messages are kept — nothing is overwritten. " +
      "When you're asking a question, also pass status in_progress so the ask waits for Nora; when she answers, the ask comes back to you as new with needsYourReply. " +
      "Use update_ask's note only for the final one- or two-line summary of what you did.",
    inputSchema: {
      ask_id: z.string(),
      body: z.string().min(1).max(4000).describe("Your message to Nora, in plain words."),
      status: z.enum(["in_progress", "done"]).optional().describe("Optionally move the ask too: in_progress when waiting on Nora's answer."),
    },
    annotations: WRITE,
  }, async ({ ask_id, body, status }) => run(async () => {
    const msg = await addAskMessage(ask_id, body, ACTOR);
    const row = status ? await updateAsk(ask_id, { status }, ACTOR) : null;
    return { ok: true, messageId: msg.id, askStatus: row?.status ?? msg.status };
  }));

  server.registerTool("update_ask", {
    title: "Update an ask",
    description:
      "Record progress on an ask. `note` is your summary shown to Nora at the top of the ask's conversation — say plainly what you did (e.g. \"Drafted 3 Instagram captions — see Review\"). " +
      "The note REPLACES any earlier note. For questions or back-and-forth, use reply_to_ask instead (it keeps the conversation). " +
      "Use status in_progress while waiting on Nora's answers, done when the work is drafted. Set client_id if the ask didn't name a business and you worked out which one.",
    inputSchema: {
      ask_id: z.string(),
      status: z.enum(["in_progress", "done"]).optional(),
      note: z.string().max(4000).optional().describe("Short summary of what you did. Replaces the previous note. Ask questions with reply_to_ask."),
      client_id: clientId.optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ ask_id, status, note, client_id }) => run(async () => {
    if (client_id) await requireClient(client_id);
    if (status === undefined && note === undefined && client_id === undefined) throw new ToolError("Pass status, note or client_id.");
    const row = await updateAsk(ask_id, { status, claudeNote: note, clientId: client_id }, ACTOR);
    return { ok: true, ask: { id: row.id, status: row.status, claudeNote: row.claudeNote, businessId: row.clientId } };
  }));

  /* ── Tasks ── */

  server.registerTool("list_tasks", {
    title: "List tasks",
    description:
      "Lists checklist tasks. Default status \"open\" = todo, in_progress, needs_review, blocked. Filter by business, month (YYYY-MM) and assignee (nora, cameron, claude, unassigned). " +
      "Tasks with a deliverableId are the monthly plan items (e.g. \"Instagram feed posts — 3 of 8\"). " +
      "scope: \"adhoc\" = one-off tasks outside the monthly plan (what Nora hands off), \"plan\" = monthly plan items, \"all\" (default).",
    inputSchema: {
      client_id: clientId.optional(),
      status: z.enum(["open", ...schema.TASK_STATUSES]).default("open"),
      month: monthArg.optional(),
      assignee: z.enum(schema.ASSIGNEES).optional(),
      scope: z.enum(TASK_SCOPES).default("all"),
      limit: limit(50, 200),
    },
    annotations: READ,
  }, async ({ client_id, status, month, assignee, scope, limit }) => run(async () => {
    const names = await clientNames();
    return (await listTasks({ clientId: client_id, status, month, assignee, scope, limit })).map((t) => shapeTask(t, names));
  }));

  server.registerTool("create_task", {
    title: "Create a task",
    description:
      "Adds a task to the checklist — e.g. things a person must do (\"Nora: film a reel of the new bowl\" assigned to nora) or follow-up work for yourself (assignee claude). " +
      "Link ask_id when the task came from an ask, and deliverable_id when it counts toward a monthly plan item. " +
      "Don't create tasks for drafts you can write right now — just write the draft (create_draft) instead.",
    inputSchema: {
      client_id: clientId.optional().describe("Business id; omit only for work that isn't tied to one business."),
      title: z.string().min(1).max(200),
      details: z.string().max(4000).optional(),
      platform: z.enum(schema.PLATFORMS).optional(),
      assignee: z.enum(schema.ASSIGNEES).default("unassigned"),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      month: monthArg.optional().describe("Month it counts toward; defaults to the due date's month or the current month."),
      status: z.enum(["todo", "in_progress", "blocked"]).default("todo"),
      deliverable_id: z.string().optional(),
      ask_id: z.string().optional(),
    },
    annotations: WRITE,
  }, async (a) => run(async () => {
    if (a.client_id) await requireClient(a.client_id);
    const id = await createTask({
      clientId: a.client_id, title: a.title, details: a.details, platform: a.platform, assignee: a.assignee, dueDate: a.due_date,
      month: a.month, status: a.status, deliverableId: a.deliverable_id, askId: a.ask_id,
    }, ACTOR);
    return { ok: true, taskId: id };
  }));

  server.registerTool("update_task", {
    title: "Update a task",
    description:
      "Edits a task: status, title, details, assignee, due date, month. You may mark a task done only for internal work that needs no approval (research, recording numbers). " +
      "Monthly-plan tasks (with a deliverableId) and anything outbound are completed automatically when a person approves/sends/publishes the linked draft — " +
      "for those, create the draft with task_id (the task moves to needs_review) instead of marking it done. Use blocked + details to explain what's missing.",
    inputSchema: {
      task_id: z.string(),
      status: z.enum(schema.TASK_STATUSES).optional(),
      title: z.string().min(1).max(200).optional(),
      details: z.string().max(4000).optional(),
      assignee: z.enum(schema.ASSIGNEES).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("YYYY-MM-DD, or null to clear."),
      month: monthArg.optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    const db = await getDb();
    const [cur] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, a.task_id));
    if (!cur) throw new ToolError(`No task with id "${a.task_id}".`);
    if (a.status === "done" && cur.status !== "done" && cur.deliverableId)
      throw new ToolError("This is a monthly-plan task: it completes when a person sends/publishes the linked draft. Create a draft with task_id instead.");
    const row = await updateTask(a.task_id, {
      status: a.status, title: a.title, details: a.details, assignee: a.assignee, dueDate: a.due_date, month: a.month,
    }, ACTOR);
    return { ok: true, task: shapeTask(row, await clientNames()) };
  }));

  server.registerTool("generate_month_tasks", {
    title: "Generate monthly checklist",
    description:
      "Turns a business's monthly plan (deliverables) into checklist tasks for a month, topping up to each target. Safe to re-run: it only adds what's missing. " +
      "Use when get_briefing shows needsMonthTasks for a business, or at the start of a month.",
    inputSchema: { client_id: clientId, month: monthArg.optional().describe("YYYY-MM; defaults to the current month.") },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ client_id, month }) => run(async () => {
    await requireClient(client_id);
    const m = monthOrCurrent(month);
    const created = await generateMonthTasks(client_id, m, ACTOR);
    return { ok: true, month: m, tasksCreated: created };
  }));

  /* ── Drafts ── */

  server.registerTool("list_drafts", {
    title: "List drafts",
    description:
      "Lists drafts (everything written for human approval). Statuses: needs_review (waiting on a person), rejected (sent back — see reviewNote, fix with revise_draft), " +
      "approved (a person will send/post it), sent, failed. Check here before drafting to avoid duplicates.",
    inputSchema: {
      status: z.enum(schema.DRAFT_STATUSES).optional(),
      client_id: clientId.optional(),
      kind: z.enum(schema.DRAFT_KINDS).optional(),
      limit: limit(30),
    },
    annotations: READ,
  }, async ({ status, client_id, kind, limit }) => run(async () => {
    const names = await clientNames();
    return (await listDrafts({ status, clientId: client_id, kind, limit })).map((d) => shapeDraft(d, names, false));
  }));

  server.registerTool("create_draft", {
    title: "Create a draft for approval",
    description:
      "Creates a draft that Cameron or Nora will review and approve in the app. Nothing is sent or posted by this call. " +
      "`meta` requirements by kind:\n" +
      "• instagram_post / tiktok_post: body = the caption. meta optional: postId (an existing idea/drafted calendar post to fill), format " +
      "(instagram: feed|reel|carousel|story; tiktok: video|carousel), mediaUrls (absolute URLs, e.g. ask attachments), scheduledFor (ISO 8601 with offset, e.g. 2026-11-14T17:30:00-05:00). " +
      "Without postId a calendar post is created automatically. Caption ≤2200 chars, ≤30 hashtags (aim 3–8); TikTok short.\n" +
      "• review_reply: meta.reviewId (from list_reviews). body = the reply. Thank by first name, specific, <~80 words, no incentives, never ask to change a rating.\n" +
      "• outreach_email: meta.outreachId (from upsert_outreach) + meta.subject; meta.to optional (defaults to the creator's saved public email; if given it must match it). " +
      "body = the email. Personalised, says who we are + which business, clear offer, FTC line \"If you post, please tag it as gifted/#ad\", never ask for Google/Yelp reviews.\n" +
      "• outreach_dm: meta.outreachId + meta.channel (instagram_dm|tiktok_dm); meta.profileUrl optional (filled from the creator's handle). A person copies and sends it from the app.\n" +
      "• lead_email / lead_dm (a pitch to a potential new client from list_leads — client_id not needed): meta.leadId required. lead_email needs meta.subject and goes to the lead's saved public email; " +
      "lead_dm needs meta.channel (instagram_dm|tiktok_dm) and a saved handle. Same rules as draft_lead_pitch (short, written as Nora, no guarantees, easy opt-out). Leads marked lost/not_a_fit or with a pending pitch are refused.\n" +
      "• report: a client recap (use get_monthly_report). • other: anything else that needs a human look.\n" +
      "Always pass task_id when the draft fulfils a checklist task (it moves to needs_review and completes on send/publish) and ask_id when it answers an ask. " +
      "Refuses duplicates when a review/outreach/post already has a pending draft — revise that one instead. Do-not-contact creators are refused.",
    inputSchema: {
      kind: z.enum(["instagram_post", "tiktok_post", "review_reply", "outreach_email", "outreach_dm", "lead_email", "lead_dm", "report", "other"]),
      client_id: clientId.optional().describe("Business id from list_clients, e.g. \"poke-bros\". Required for every kind except lead_email / lead_dm."),
      title: z.string().min(1).max(200).describe("Short label shown in the review queue, e.g. \"IG reel: spicy crab boil\"."),
      body: z.string().min(1).max(20000).describe("The exact text to be posted/sent."),
      meta: z.record(z.string(), z.unknown()).default({}).describe("Kind-specific fields; see description."),
      task_id: z.string().optional(),
      ask_id: z.string().optional(),
    },
    annotations: WRITE,
  }, async (a) => run(async () => {
    if (a.kind === "lead_email" || a.kind === "lead_dm") {
      const leadId = String(a.meta.leadId ?? "");
      if (!leadId) throw new ToolError(`${a.kind} needs meta.leadId (from list_leads).`);
      const channel = a.kind === "lead_email" ? "email" : String(a.meta.channel ?? "");
      if (channel !== "email" && channel !== "instagram_dm" && channel !== "tiktok_dm") throw new ToolError("lead_dm needs meta.channel: instagram_dm or tiktok_dm.");
      return draftLeadPitch({
        lead_id: leadId, channel, title: a.title, body: a.body, ask_id: a.ask_id,
        subject: a.meta.subject === undefined ? undefined : String(a.meta.subject),
      });
    }
    if (!a.client_id) throw new ToolError(`${a.kind} needs client_id.`);
    const client = await requireClient(a.client_id);
    const db = await getDb();
    const meta: Record<string, unknown> = { ...a.meta };
    const warnings: string[] = [];
    if (a.kind === "report" && ("reportId" in meta || "audience" in meta))
      throw new ToolError("Monthly owner reports come from create_report, not create_draft — don't pass meta.reportId/audience here.");

    if (a.task_id) {
      const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, a.task_id));
      if (!t) throw new ToolError(`No task with id "${a.task_id}".`);
      if (t.clientId && t.clientId !== client.id) throw new ToolError(`Task ${a.task_id} belongs to a different business (${t.clientId}).`);
      if (t.status === "done") warnings.push("That task is already done.");
    }
    if (a.ask_id) {
      const [ask] = await db.select({ id: schema.asks.id }).from(schema.asks).where(eq(schema.asks.id, a.ask_id));
      if (!ask) throw new ToolError(`No ask with id "${a.ask_id}".`);
    }

    if (a.kind === "instagram_post" || a.kind === "tiktok_post") {
      const platform = a.kind === "instagram_post" ? "instagram" : "tiktok";
      checkCaption(platform, a.body, warnings);
      checkFormat(platform, meta.format);
      const mediaUrls = checkMediaUrls(meta.mediaUrls);
      const scheduledFor = checkSchedule(meta.scheduledFor, warnings);
      if (mediaUrls !== undefined) meta.mediaUrls = mediaUrls;
      if (scheduledFor !== undefined) meta.scheduledFor = scheduledFor;
      if (!mediaUrls?.length && !meta.postId) warnings.push("No media attached — a person will need to add the photo/video before posting.");
      if (meta.postId) {
        const post = await getPost(String(meta.postId));
        if (post.clientId !== client.id) throw new ToolError("That post belongs to a different business.");
        if (post.platform !== platform) throw new ToolError(`That post is a ${post.platform} post; use kind ${post.platform}_post.`);
        if (!EDITABLE_POST.includes(post.status)) throw new ToolError(`That post is already ${post.status}; you can only draft for idea/drafted posts.`);
        const pending = await pendingDraftsFor("postId", post.id);
        if (pending.length) throw new ToolError(duplicateMessage("Post", pending[0]));
        if (mediaUrls !== undefined || scheduledFor !== undefined || meta.format !== undefined)
          await updatePost(post.id, {
            ...(mediaUrls !== undefined ? { mediaUrls } : {}),
            ...(scheduledFor !== undefined ? { scheduledFor } : {}),
            ...(meta.format !== undefined ? { format: meta.format as schema.PostFormat } : {}),
          }, ACTOR);
      }
    }

    if (a.kind === "review_reply") {
      const reviewId = String(meta.reviewId ?? "");
      const [r] = reviewId ? await db.select().from(schema.reviews).where(eq(schema.reviews.id, reviewId)) : [];
      if (!r) throw new ToolError("review_reply needs meta.reviewId of a synced Google review (see list_reviews).");
      if (r.clientId !== client.id) throw new ToolError("That review belongs to a different business.");
      if (r.replyText) throw new ToolError("That review already has a reply.");
      const pending = await pendingDraftsFor("reviewId", r.id);
      if (pending.length) throw new ToolError(duplicateMessage("Review", pending[0]));
      checkReviewReply(a.body, warnings);
    }

    if (a.kind === "outreach_email" || a.kind === "outreach_dm") {
      const outreachId = String(meta.outreachId ?? "");
      const [o] = outreachId ? await db.select().from(schema.outreach).where(eq(schema.outreach.id, outreachId)) : [];
      if (!o) throw new ToolError(`${a.kind} needs meta.outreachId — create the relationship with upsert_outreach first.`);
      if (o.clientId !== client.id) throw new ToolError("That outreach record belongs to a different business.");
      const creator = await getCreator(o.creatorId);
      if (creator.doNotContact) throw new ToolError(`${creator.name} is marked do-not-contact. Don't draft outreach to them.`);
      if (["declined", "agreed", "visit_scheduled", "posted"].includes(o.stage)) warnings.push(`Outreach stage is ${o.stage} — make sure this message fits.`);
      const pending = await pendingDraftsFor("outreachId", o.id);
      if (pending.length) throw new ToolError(duplicateMessage("This creator", pending[0]));
      checkOutreach(a.body, warnings);
      if (a.kind === "outreach_email") {
        if (!meta.subject || !String(meta.subject).trim()) throw new ToolError("outreach_email needs meta.subject.");
        if (meta.to !== undefined) {
          const to = String(meta.to).trim().toLowerCase();
          if (!creator.email) throw new ToolError("Save the creator's publicly listed email with upsert_creator first (note where it's listed), then draft without meta.to.");
          if (to !== creator.email) throw new ToolError(`meta.to (${to}) doesn't match the creator's saved email. Only use their publicly listed address.`);
        } else if (!creator.email) {
          throw new ToolError(`${creator.name} has no saved email. Use a DM (outreach_dm) or save their publicly listed email with upsert_creator first.`);
        }
      } else {
        const channel = String(meta.channel ?? o.channel);
        if (channel !== "instagram_dm" && channel !== "tiktok_dm") throw new ToolError("outreach_dm needs meta.channel: instagram_dm or tiktok_dm.");
        meta.channel = channel;
        meta.profileUrl = meta.profileUrl ?? profileUrl(channel, creator);
        if (!meta.profileUrl) warnings.push(`No ${channel === "instagram_dm" ? "Instagram" : "TikTok"} handle saved for ${creator.name}.`);
      }
    }

    const id = await createDraft({ clientId: client.id, kind: a.kind, title: a.title, body: a.body, meta, taskId: a.task_id, askId: a.ask_id }, ACTOR);
    return { ok: true, draftId: id, status: "needs_review", warnings: warnings.length ? warnings : undefined };
  }));

  server.registerTool("revise_draft", {
    title: "Revise a draft",
    description:
      "Edits a draft that is still waiting for review (needs_review) or was sent back (rejected). Revising a rejected draft resubmits it for review. " +
      "Read the draft's reviewNote first and address it specifically. `meta` is merged into the existing meta; you can't change which review/outreach/post it points at. " +
      "For post drafts, meta.mediaUrls / meta.scheduledFor / meta.format also update the calendar post.",
    inputSchema: {
      draft_id: z.string(),
      body: z.string().min(1).max(20000).optional(),
      title: z.string().min(1).max(200).optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    const db = await getDb();
    const [cur] = await db.select().from(schema.drafts).where(eq(schema.drafts.id, a.draft_id));
    if (!cur) throw new ToolError(`No draft with id "${a.draft_id}".`);
    if (cur.status !== "needs_review" && cur.status !== "rejected")
      throw new ToolError(`Draft is ${cur.status}; only needs_review or rejected drafts can be revised.`);
    if (a.body === undefined && a.title === undefined && a.meta === undefined) throw new ToolError("Pass body, title or meta.");
    const warnings: string[] = [];
    const meta = a.meta ? { ...a.meta } : undefined;
    if (meta) {
      for (const key of ["reviewId", "outreachId", "postId", "leadId", "reportId", "audience"]) {
        if (key in meta && String(meta[key]) !== String(cur.meta[key] ?? "")) throw new ToolError(`Can't change meta.${key} — create a new draft instead.`);
      }
      if (cur.kind === "outreach_email" && meta.to !== undefined && String(meta.to).trim().toLowerCase() !== String(cur.meta.to ?? "").toLowerCase())
        throw new ToolError("Can't change the recipient. Only the creator's saved, publicly listed email is used.");
      if (cur.kind === "outreach_dm" && meta.channel !== undefined && meta.channel !== "instagram_dm" && meta.channel !== "tiktok_dm")
        throw new ToolError("meta.channel must be instagram_dm or tiktok_dm.");
    }
    const body = a.body ?? cur.body;
    if (cur.kind === "instagram_post" || cur.kind === "tiktok_post") {
      const platform = cur.kind === "instagram_post" ? "instagram" : "tiktok";
      checkCaption(platform, body, warnings);
      if (meta) {
        checkFormat(platform, meta.format);
        const mediaUrls = checkMediaUrls(meta.mediaUrls);
        const scheduledFor = checkSchedule(meta.scheduledFor, warnings);
        if (mediaUrls !== undefined) meta.mediaUrls = mediaUrls;
        if (scheduledFor !== undefined) meta.scheduledFor = scheduledFor;
        const postId = cur.meta.postId ? String(cur.meta.postId) : null;
        if (postId && (mediaUrls !== undefined || scheduledFor !== undefined || meta.format !== undefined)) {
          const post = await getPost(postId);
          if (!EDITABLE_POST.includes(post.status)) throw new ToolError(`The calendar post is already ${post.status}; ask a person to change it.`);
          await updatePost(postId, {
            ...(mediaUrls !== undefined ? { mediaUrls } : {}),
            ...(scheduledFor !== undefined ? { scheduledFor } : {}),
            ...(meta.format !== undefined ? { format: meta.format as schema.PostFormat } : {}),
          }, ACTOR);
        }
      }
    }
    if (cur.kind === "review_reply") checkReviewReply(body, warnings);
    if (cur.kind === "outreach_email" || cur.kind === "outreach_dm") checkOutreach(body, warnings);
    if (cur.kind === "lead_email" || cur.kind === "lead_dm") checkPitch(cur.kind, body, warnings);

    await reviseDraft(a.draft_id, { body: a.body, title: a.title, meta }, ACTOR);
    return { ok: true, draftId: a.draft_id, status: "needs_review", resubmitted: cur.status === "rejected", warnings: warnings.length ? warnings : undefined };
  }));

  /* ── Content calendar ── */

  server.registerTool("list_calendar", {
    title: "List content calendar",
    description:
      "Lists Instagram/TikTok calendar posts scheduled in a month (default current), plus unscheduled ideas/drafts. Each post shows its status " +
      "(idea, drafted, approved, scheduled, publishing, published, failed) and its linked draft if any. Use it to plan posting cadence against the monthly plan.",
    inputSchema: { client_id: clientId.optional(), month: monthArg.optional() },
    annotations: READ,
  }, async ({ client_id, month }) => run(async () => {
    if (client_id) await requireClient(client_id);
    return listCalendar({ clientId: client_id, month: monthOrCurrent(month) });
  }));

  server.registerTool("create_post", {
    title: "Add a calendar idea",
    description:
      "Adds a post IDEA or placeholder to the content calendar (status idea or drafted). To propose an actual caption for approval use create_draft " +
      "(kind instagram_post / tiktok_post) — it creates the calendar post for you. You cannot schedule or publish; a person does that after approving.",
    inputSchema: {
      client_id: clientId,
      platform: z.enum(schema.POST_PLATFORMS),
      format: z.enum(schema.POST_FORMATS).optional().describe("instagram: feed|reel|carousel|story; tiktok: video|carousel."),
      caption: z.string().max(2200).optional().describe("Idea notes or a working caption."),
      media_urls: z.array(z.string().url()).optional(),
      scheduled_for: z.string().optional().describe("Proposed ISO 8601 date-time with offset."),
      status: z.enum(["idea", "drafted"]).default("idea"),
      task_id: z.string().optional(),
    },
    annotations: WRITE,
  }, async (a) => run(async () => {
    await requireClient(a.client_id);
    const warnings: string[] = [];
    checkFormat(a.platform, a.format);
    if (a.caption) checkCaption(a.platform, a.caption, warnings);
    const scheduledFor = checkSchedule(a.scheduled_for, warnings);
    const id = await createPost({
      clientId: a.client_id, platform: a.platform, format: a.format ?? (a.platform === "tiktok" ? "video" : "feed"), caption: a.caption,
      mediaUrls: a.media_urls ?? [], scheduledFor: scheduledFor ?? null, status: a.status, taskId: a.task_id, publishMode: "manual",
    }, ACTOR);
    return { ok: true, postId: id, warnings: warnings.length ? warnings : undefined };
  }));

  server.registerTool("update_post", {
    title: "Update a calendar idea",
    description:
      "Edits a calendar post that is still an idea or drafted: caption, format, media, proposed time, or status (idea|drafted only). " +
      "Approved/scheduled/published posts can't be changed by Claude. If the post has a pending draft, make every change (caption, media, time, format) with revise_draft instead.",
    inputSchema: {
      post_id: z.string(),
      caption: z.string().max(2200).optional(),
      format: z.enum(schema.POST_FORMATS).optional(),
      media_urls: z.array(z.string().url()).optional(),
      scheduled_for: z.string().nullable().optional().describe("ISO 8601 date-time with offset, or null to clear."),
      status: z.enum(["idea", "drafted"]).optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    const post = await getPost(a.post_id);
    if (!EDITABLE_POST.includes(post.status)) throw new ToolError(`This post is ${post.status}; only idea/drafted posts can be edited by Claude.`);
    const warnings: string[] = [];
    checkFormat(post.platform, a.format);
    if (a.caption !== undefined) checkCaption(post.platform, a.caption, warnings);
    const changing = [a.caption, a.format, a.media_urls, a.scheduled_for, a.status].some((x) => x !== undefined);
    if (changing) {
      // Any change to a post under review must go through revise_draft, so the reviewer sees exactly what they approve.
      const pending = await pendingDraftsFor("postId", post.id);
      if (pending.length) throw new ToolError(`This post is in draft ${pending[0].id} (${pending[0].status}) — use revise_draft (body, or meta.mediaUrls / meta.scheduledFor / meta.format) so the reviewer sees the change.`);
    }
    const scheduledFor = checkSchedule(a.scheduled_for, warnings);
    const row = await updatePost(a.post_id, {
      ...(a.caption !== undefined ? { caption: a.caption } : {}),
      ...(a.format !== undefined ? { format: a.format } : {}),
      ...(a.media_urls !== undefined ? { mediaUrls: a.media_urls } : {}),
      ...(scheduledFor !== undefined ? { scheduledFor } : {}),
      ...(a.status !== undefined ? { status: a.status } : {}),
    }, ACTOR);
    return { ok: true, post: shapePost(row), warnings: warnings.length ? warnings : undefined };
  }));

  /* ── Creators & outreach ── */

  server.registerTool("search_creators", {
    title: "Search creators",
    description:
      "Searches the creator/influencer database by name, handle, email, city, niche or notes, optionally only creators in a business's outreach pipeline and/or at a stage. " +
      "Each creator includes their outreach relationships with every business. Do-not-contact creators are hidden unless include_do_not_contact is true. " +
      "Always search before adding a creator to avoid duplicates. " +
      "When researching new local creators for a business, look in its outreachAreas (from list_clients / get_client_month, e.g. Richmond or 757 / Hampton Roads); if empty, use the business's city.",
    inputSchema: {
      q: z.string().optional(),
      client_id: clientId.optional(),
      stage: z.enum(schema.OUTREACH_STAGES).optional(),
      include_do_not_contact: z.boolean().default(false),
      limit: limit(25),
    },
    annotations: READ,
  }, async ({ q, client_id, stage, include_do_not_contact, limit }) => run(async () =>
    searchCreators({ q, clientId: client_id, stage, includeDoNotContact: include_do_not_contact, limit })));

  server.registerTool("upsert_creator", {
    title: "Add or update a creator",
    description:
      "Adds a creator or updates one (matched by id, Instagram handle, TikTok handle or email — so it won't duplicate). Fields you omit are left unchanged. " +
      "Only save emails that are publicly listed (bio, website, link-in-bio) and note where you found them in notes. Never invent follower counts — omit what you don't know. " +
      "Set do_not_contact true if a creator asked not to be contacted or is unsuitable; you can't clear it.",
    inputSchema: {
      id: z.string().optional(),
      name: z.string().min(1),
      instagram_handle: z.string().optional().describe("With or without @."),
      tiktok_handle: z.string().optional(),
      email: z.string().email().optional(),
      city: z.string().optional(),
      niche: z.string().optional().describe("e.g. \"Richmond food & brunch\"."),
      instagram_followers: z.number().int().nonnegative().optional(),
      tiktok_followers: z.number().int().nonnegative().optional(),
      engagement_rate: z.number().nonnegative().max(100).optional().describe("Percent, e.g. 3.4"),
      notes: z.string().max(4000).optional().describe("Replaces existing notes — include anything still relevant."),
      source: z.string().default("claude research"),
      do_not_contact: z.literal(true).optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    if (a.id) await getCreator(a.id);
    const id = await upsertCreator({
      id: a.id, name: a.name, instagramHandle: a.instagram_handle, tiktokHandle: a.tiktok_handle, email: a.email, city: a.city, niche: a.niche,
      instagramFollowers: a.instagram_followers, tiktokFollowers: a.tiktok_followers, engagementRate: a.engagement_rate, notes: a.notes,
      source: a.source, doNotContact: a.do_not_contact,
    }, ACTOR);
    return { ok: true, creator: shapeCreator(await getCreator(id)) };
  }));

  server.registerTool("upsert_outreach", {
    title: "Add creator to a business's outreach",
    description:
      "Creates or updates the outreach relationship between one business and one creator (one per pair). You may set stage sourced (found, worth considering) or " +
      "shortlisted (recommended to contact). Later stages (contacted, followed_up, replied, …) are recorded by a person — contacted is set automatically when they mark your outreach draft sent. " +
      "Set channel (instagram_dm, tiktok_dm, email) and comp_type (gifted, paid, affiliate, tbd). Returns outreachId to use in create_draft meta. Do-not-contact creators are refused.",
    inputSchema: {
      client_id: clientId,
      creator_id: z.string(),
      channel: z.enum(schema.OUTREACH_CHANNELS),
      stage: z.enum(["sourced", "shortlisted"]).optional(),
      comp_type: z.enum(["gifted", "paid", "affiliate", "tbd"]).optional(),
      notes: z.string().max(4000).optional().describe("Why this creator fits / content ideas. Replaces existing notes."),
      next_follow_up_at: z.string().optional().describe("ISO date-time to follow up."),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    await requireClient(a.client_id);
    const creator = await getCreator(a.creator_id);
    if (creator.doNotContact) throw new ToolError(`${creator.name} is marked do-not-contact.`);
    const db = await getDb();
    const [existing] = await db.select().from(schema.outreach).where(and(eq(schema.outreach.clientId, a.client_id), eq(schema.outreach.creatorId, a.creator_id)));
    if (existing && a.stage && !["sourced", "shortlisted"].includes(existing.stage))
      throw new ToolError(`Already at stage ${existing.stage}; only a person can change it from here. Omit stage to update other fields.`);
    if (existing && a.channel !== existing.channel) {
      const pending = await pendingDraftsFor("outreachId", existing.id);
      if (pending.length) throw new ToolError(`There's a pending draft (${pending[0].id}) for this creator on ${existing.channel}; revise it instead of switching channel.`);
    }
    let next: Date | undefined;
    if (a.next_follow_up_at) {
      next = new Date(a.next_follow_up_at);
      if (Number.isNaN(next.getTime())) throw new ToolError("next_follow_up_at must be an ISO date-time.");
    }
    const id = await upsertOutreach({
      clientId: a.client_id, creatorId: a.creator_id, channel: a.channel, stage: a.stage, compType: a.comp_type, notes: a.notes, nextFollowUpAt: next,
    }, ACTOR);
    const [row] = await db.select().from(schema.outreach).where(eq(schema.outreach.id, id));
    return { ok: true, outreachId: id, created: !existing, outreach: shapeOutreach(row, await clientNames()) };
  }));

  server.registerTool("list_followups_due", {
    title: "List follow-ups due",
    description:
      "Creators who were contacted (or followed up) and haven't replied, whose follow-up date has arrived (or arrives within within_days). Includes the last message sent " +
      "and any pending follow-up draft. Draft ONE short, friendly follow-up per creator (create_draft with the same outreachId, referencing the first message); don't follow up more than twice.",
    inputSchema: { client_id: clientId.optional(), within_days: z.number().int().min(0).max(30).default(0) },
    annotations: READ,
  }, async ({ client_id, within_days }) => run(async () => listFollowUpsDue({ clientId: client_id, withinDays: within_days })));

  /* ── Reviews ── */

  server.registerTool("list_reviews", {
    title: "List Google reviews",
    description:
      "Lists synced Google Business reviews, newest first (default: only those without a reply). Each shows rating, reviewer name, comment, and any existing reply draft. " +
      "Draft replies with create_draft kind review_reply, meta.reviewId = id. Skip reviews that already have a replyDraft.",
    inputSchema: {
      client_id: clientId.optional(),
      unreplied_only: z.boolean().default(true),
      max_rating: z.number().int().min(1).max(5).optional().describe("e.g. 3 to see only 1–3 star reviews."),
      limit: limit(30),
    },
    annotations: READ,
  }, async ({ client_id, unreplied_only, max_rating, limit }) => run(async () =>
    listReviews({ clientId: client_id, unrepliedOnly: unreplied_only, maxRating: max_rating, limit })));

  /* ── Metrics & reports ── */

  server.registerTool("record_metrics", {
    title: "Record monthly numbers",
    description:
      "Saves a business's monthly numbers for one platform — only numbers Nora or Cameron gave you (e.g. pasted from Instagram/TikTok insights in an ask). Never estimate. " +
      "views = impressions/views for the month (Instagram now calls impressions \"views\"); reach, followers (end-of-month total) and engagements are optional. " +
      "Fields you omit keep their saved value. Numbers synced from the API aren't overwritten unless overwrite_api_numbers is true.",
    inputSchema: {
      client_id: clientId,
      month: monthArg,
      platform: z.enum(["instagram", "tiktok", "google"]),
      views: z.number().int().nonnegative(),
      reach: z.number().int().nonnegative().optional(),
      followers: z.number().int().nonnegative().optional(),
      engagements: z.number().int().nonnegative().optional(),
      overwrite_api_numbers: z.boolean().default(false),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, async (a) => run(async () => {
    await requireClient(a.client_id);
    const db = await getDb();
    const [cur] = await db.select().from(schema.monthlyMetrics).where(and(
      eq(schema.monthlyMetrics.clientId, a.client_id), eq(schema.monthlyMetrics.month, a.month), eq(schema.monthlyMetrics.platform, a.platform),
    ));
    if (cur?.source === "api" && !a.overwrite_api_numbers)
      throw new ToolError(`${a.platform} ${a.month} numbers were synced from the API. Pass overwrite_api_numbers: true only if Nora asked to replace them.`);
    await upsertMetric({
      clientId: a.client_id, month: a.month, platform: a.platform, source: "manual",
      views: a.views,
      reach: a.reach ?? cur?.reach ?? null,
      followers: a.followers ?? cur?.followers ?? null,
      engagements: a.engagements ?? cur?.engagements ?? null,
    }, ACTOR);
    return { ok: true, saved: { businessId: a.client_id, month: a.month, platform: a.platform, views: a.views, reach: a.reach ?? cur?.reach, followers: a.followers ?? cur?.followers, engagements: a.engagements ?? cur?.engagements } };
  }));

  server.registerTool("get_monthly_report", {
    title: "Get monthly report data",
    description:
      "Structured month summary for one business, for writing a client recap: plan vs done, tasks completed/open, posts published (with links), what was sent by kind, " +
      "metrics with change vs previous month and same month last year, reviews (new, average rating, replied), creators contacted/posted and pipeline by stage, and any missing data. " +
      "Defaults to last month. To deliver a recap, write it with create_draft kind report — never state numbers that aren't in this data.",
    inputSchema: { client_id: clientId, month: monthArg.optional().describe("YYYY-MM; defaults to last month.") },
    annotations: READ,
  }, async ({ client_id, month }) => run(async () => {
    const m = month === undefined ? addMonths(currentMonth(), -1) : monthOrCurrent(month);
    const report = await getMonthlyReport(client_id, m);
    if (!report) throw new ToolError(`No business with id "${client_id}". Call list_clients for valid ids.`);
    return report;
  }));
}

