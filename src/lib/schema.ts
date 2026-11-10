import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Single source of truth for the data model.
 * Conventions:
 *  - ids are text. Clients use readable slugs; everything else uses newId() from lib/ids.
 *  - `month` columns are "YYYY-MM" strings (see lib/dates).
 *  - actors (createdBy / reviewedBy / actor) are a user email, or "claude" for agent writes.
 */

export const PLATFORMS = ["instagram", "tiktok", "google", "email", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const clients = pgTable("clients", {
  id: text("id").primaryKey(), // slug, e.g. "yummy-red-bowl-richmond"
  name: text("name").notNull(),
  location: text("location"),
  brand: text("brand"), // groups multi-location brands, e.g. "Yummy Red Bowl"
  instagramHandle: text("instagram_handle"),
  tiktokHandle: text("tiktok_handle"),
  website: text("website"),
  googleLocation: text("google_location"), // v4 resource name "accounts/{a}/locations/{l}"
  brandVoice: text("brand_voice"), // tone, do/don't, signature dishes — fed to Claude
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Recurring monthly commitments per client ("what we need to do each month"). */
export const deliverables = pgTable("deliverables", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  title: text("title").notNull(), // e.g. "Instagram feed posts"
  platform: text("platform").$type<Platform>().notNull(),
  targetPerMonth: integer("target_per_month").notNull().default(1), // 0 = "as needed / all"
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const ASK_STATUSES = ["new", "in_progress", "done", "archived"] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

/** Free-form drop-ins from Nora (or Cameron) for Claude to pick up. */
export const asks = pgTable(
  "asks",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<Attachment[]>().notNull().default([]),
    status: text("status").$type<AskStatus>().notNull().default("new"),
    createdBy: text("created_by").notNull(),
    claudeNote: text("claude_note"), // what Claude did / questions back
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asks_status_idx").on(t.status)],
);

export type Attachment = { url: string; name: string; contentType?: string };

/**
 * The back-and-forth on an ask: Claude's questions/updates and Nora's (or Cameron's) answers.
 * `author` is a user email, or "claude". The ask's original body is the first "message";
 * asks.claudeNote stays as Claude's latest summary (shown as its first message if present).
 */
export const askMessages = pgTable(
  "ask_messages",
  {
    id: text("id").primaryKey(),
    askId: text("ask_id").notNull().references(() => asks.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_messages_ask_idx").on(t.askId, t.createdAt)],
);

export const TASK_STATUSES = ["todo", "in_progress", "needs_review", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const ASSIGNEES = ["nora", "cameron", "claude", "unassigned"] as const;
export type Assignee = (typeof ASSIGNEES)[number];

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    details: text("details"),
    platform: text("platform").$type<Platform>(),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    assignee: text("assignee").$type<Assignee>().notNull().default("unassigned"),
    dueDate: text("due_date"), // "YYYY-MM-DD"
    month: text("month").notNull(), // "YYYY-MM" the task counts toward
    deliverableId: text("deliverable_id").references(() => deliverables.id, { onDelete: "set null" }),
    askId: text("ask_id").references(() => asks.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("tasks_client_month_idx").on(t.clientId, t.month), index("tasks_status_idx").on(t.status)],
);

export const DRAFT_KINDS = [
  "instagram_post",
  "tiktok_post",
  "review_reply",
  "outreach_email",
  "outreach_dm",
  "comment_reply",
  "report",
  "other",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const DRAFT_STATUSES = ["needs_review", "approved", "rejected", "sent", "failed"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/**
 * Anything Claude writes that a human must approve.
 * meta by kind:
 *  instagram_post / tiktok_post: { postId }  (content_posts row holding caption/media/schedule)
 *  review_reply:  { reviewId }
 *  outreach_email: { outreachId, to, subject }
 *  outreach_dm:   { outreachId, channel: "instagram_dm" | "tiktok_dm", profileUrl }
 *  comment_reply: { commentId, mediaId, connectionId }
 */
export const drafts = pgTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    kind: text("kind").$type<DraftKind>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<DraftStatus>().notNull().default("needs_review"),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    askId: text("ask_id").references(() => asks.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull().default("claude"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("drafts_status_idx").on(t.status)],
);

export const POST_PLATFORMS = ["instagram", "tiktok"] as const;
export const POST_FORMATS = ["feed", "reel", "carousel", "story", "video"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export const POST_STATUSES = ["idea", "drafted", "approved", "scheduled", "publishing", "published", "failed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Content calendar entries. publishMode "manual" = a human posts it from the app, then marks published. */
export const contentPosts = pgTable(
  "content_posts",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform").$type<(typeof POST_PLATFORMS)[number]>().notNull(),
    format: text("format").$type<PostFormat>().notNull().default("feed"),
    caption: text("caption"),
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    status: text("status").$type<PostStatus>().notNull().default("idea"),
    publishMode: text("publish_mode").$type<"auto" | "manual">().notNull().default("manual"),
    externalId: text("external_id"),
    permalink: text("permalink"),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    error: text("error"),
    /** When the publish cron claimed it (status → publishing). Lets the cron recover posts left stuck by a killed run. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** Instagram media container still processing (e.g. a long reel). Reused on the next run instead of creating a new one. */
    igContainer: jsonb("ig_container").$type<IgContainer | null>(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posts_client_sched_idx").on(t.clientId, t.scheduledFor)],
);

/** `key` fingerprints the caption/media/format the container was built from, so an edited post never publishes a stale container. */
export type IgContainer = { id: string; key: string; createdAt: string };

export const creators = pgTable("creators", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  instagramHandle: text("instagram_handle"),
  tiktokHandle: text("tiktok_handle"),
  email: text("email"), // only publicly listed / vendor-supplied addresses
  city: text("city"),
  niche: text("niche"),
  instagramFollowers: integer("instagram_followers"),
  tiktokFollowers: integer("tiktok_followers"),
  engagementRate: real("engagement_rate"), // percent, e.g. 3.4
  statsUpdatedAt: timestamp("stats_updated_at", { withTimezone: true }),
  doNotContact: boolean("do_not_contact").notNull().default(false),
  notes: text("notes"),
  source: text("source"), // "claude research", "vendor", "manual"...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const OUTREACH_CHANNELS = ["instagram_dm", "tiktok_dm", "email"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];
export const OUTREACH_STAGES = [
  "sourced",
  "shortlisted",
  "contacted",
  "followed_up",
  "replied",
  "negotiating",
  "agreed",
  "visit_scheduled",
  "posted",
  "declined",
  "no_response",
] as const;
export type OutreachStage = (typeof OUTREACH_STAGES)[number];

/** One row per (client, creator) relationship. */
export const outreach = pgTable(
  "outreach",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    stage: text("stage").$type<OutreachStage>().notNull().default("sourced"),
    compType: text("comp_type").$type<"gifted" | "paid" | "affiliate" | "tbd">().notNull().default("tbd"),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    gmailThreadId: text("gmail_thread_id"),
    postUrl: text("post_url"),
    disclosureOk: boolean("disclosure_ok"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("outreach_client_creator_uq").on(t.clientId, t.creatorId), index("outreach_stage_idx").on(t.stage)],
);

/**
 * Monthly performance per client & platform. "views" is what Instagram now reports in place of the
 * deprecated "impressions" metric (Apr 2025); TikTok also reports video views.
 */
export const monthlyMetrics = pgTable(
  "monthly_metrics",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    platform: text("platform").$type<"instagram" | "tiktok" | "google">().notNull(),
    views: integer("views"),
    reach: integer("reach"),
    followers: integer("followers"),
    engagements: integer("engagements"),
    source: text("source").$type<"manual" | "api">().notNull().default("manual"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("metrics_client_month_platform_uq").on(t.clientId, t.month, t.platform)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(), // Google reviewId
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    resourceName: text("resource_name").notNull(), // accounts/{a}/locations/{l}/reviews/{r}
    rating: integer("rating"),
    reviewer: text("reviewer"),
    comment: text("comment"),
    createTime: timestamp("create_time", { withTimezone: true }),
    replyText: text("reply_text"),
    replyState: text("reply_state"), // Google's ReviewReplyState when available
    policyViolation: text("policy_violation"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_client_idx").on(t.clientId)],
);

export const PROVIDERS = ["instagram", "google", "gmail", "tiktok"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Third-party OAuth connections. Tokens are encrypted with lib/crypto and never leave the server. */
export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    provider: text("provider").$type<Provider>().notNull(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }), // null = shared (e.g. Gmail outreach inbox)
    label: text("label").notNull(), // e.g. an IG handle or the outreach Gmail address
    externalId: text("external_id"), // IG user id, Google account id, Gmail address
    tokenEnc: text("token_enc").notNull(),
    scopes: text("scopes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").$type<"ok" | "error" | "expired">().notNull().default("ok"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("connections_provider_external_uq").on(t.provider, t.externalId)],
);

/** Append-only audit trail: who approved/sent/changed what. */
export const activity = pgTable(
  "activity",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(), // e.g. "draft.approved", "task.created"
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    clientId: text("client_id"),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_created_idx").on(t.createdAt)],
);

export type Client = typeof clients.$inferSelect;
export type Deliverable = typeof deliverables.$inferSelect;
export type Ask = typeof asks.$inferSelect;
export type AskMessage = typeof askMessages.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type ContentPost = typeof contentPosts.$inferSelect;
export type Creator = typeof creators.$inferSelect;
export type Outreach = typeof outreach.$inferSelect;
export type MonthlyMetric = typeof monthlyMetrics.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type Activity = typeof activity.$inferSelect;
