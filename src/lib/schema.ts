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
  /** "business" = a managed client; "creator" = Nora's own @noraeatsgood workspace (exactly one, pinned). */
  kind: text("kind").$type<"business" | "creator">().notNull().default("business"),
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
/** What kind of drop-in it is. "auto" = not sorted yet; Claude triages it. */
export const ASK_KINDS = ["auto", "request", "idea", "update", "question"] as const;
export type AskKind = (typeof ASK_KINDS)[number];
/** Who should act on it. "auto" = let Claude route it. */
export const ASK_FOR = ["auto", "claude", "cameron", "nora", "anyone"] as const;
export type AskFor = (typeof ASK_FOR)[number];
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
    kind: text("kind").$type<AskKind>().notNull().default("auto"),
    forWho: text("for_who").$type<AskFor>().notNull().default("auto"),
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
    tag: text("tag"), // e.g. "onboarding" — groups special-purpose tasks
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
  "lead_email",
  "lead_dm",
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
    /** "client" = a managed business's account; "creator" = Nora's own @noraeatsgood accounts. */
    purpose: text("purpose").$type<"client" | "creator">().notNull().default("client"),
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

/* ───────────────────────── Leads (potential new clients) ───────────────────────── */

/** What we could do for them: manage their Google reviews, run their social, or a creator collab with Nora. */
export const LEAD_OPPORTUNITIES = ["google", "social", "collab"] as const;
export type LeadOpportunity = (typeof LEAD_OPPORTUNITIES)[number];
export const LEAD_STAGES = ["found", "qualified", "contacted", "talking", "proposal", "won", "lost", "not_a_fit"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/**
 * A business that might become a client. Facts are public info gathered by Claude or a person
 * (Google rating/review counts, IG stats); `why` explains the opportunity. Converting a won lead
 * creates a clients row (convertedClientId) with an onboarding checklist.
 */
export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    city: text("city"),
    category: text("category"), // cuisine / type, e.g. "Korean BBQ", "bakery"
    website: text("website"),
    instagramHandle: text("instagram_handle"),
    tiktokHandle: text("tiktok_handle"),
    googleMapsUrl: text("google_maps_url"),
    googleRating: real("google_rating"),
    googleReviewCount: integer("google_review_count"),
    replyRate: integer("reply_rate"), // % of recent Google reviews with an owner reply (estimate)
    instagramFollowers: integer("instagram_followers"),
    lastPostAt: timestamp("last_post_at", { withTimezone: true }),
    opportunities: jsonb("opportunities").$type<LeadOpportunity[]>().notNull().default([]),
    score: integer("score"), // 0-100 fit estimate
    why: text("why"), // the pitch angle: what's weak / what we'd fix
    stage: text("stage").$type<LeadStage>().notNull().default("found"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"), // only publicly listed business contacts
    contactPhone: text("contact_phone"),
    nextStepAt: text("next_step_at"), // "YYYY-MM-DD"
    notes: text("notes"),
    source: text("source"), // "claude research", "walk-in", "referral"...
    convertedClientId: text("converted_client_id").references(() => clients.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_stage_idx").on(t.stage)],
);

export type Lead = typeof leads.$inferSelect;

/* ───────────────────────── Quick capture (iPhone Shortcut / Siri) ───────────────────────── */

/** Per-person, revocable tokens for POST /api/asks/capture. Only a SHA-256 hash is stored. */
export const captureTokens = pgTable("capture_tokens", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  label: text("label").notNull(), // e.g. "Nora's iPhone"
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── Nora's own creator stats (@noraeatsgood) ───────────────────────── */

export const CREATOR_PLATFORMS = ["instagram", "tiktok"] as const;
export type CreatorPlatform = (typeof CREATOR_PLATFORMS)[number];

/**
 * One row per platform per day. Platforms only expose current totals (IG follower history is ~30 days,
 * TikTok none), so a daily snapshot is the only way to build long-term growth history.
 * Daily-flow metrics (views/reach/profileViews/newFollows) are for that day; totals are as of that day.
 */
export const creatorSnapshots = pgTable(
  "creator_snapshots",
  {
    id: text("id").primaryKey(),
    platform: text("platform").$type<CreatorPlatform>().notNull(),
    date: text("date").notNull(), // "YYYY-MM-DD" (America/New_York)
    followers: integer("followers"),
    following: integer("following"),
    posts: integer("posts"),
    likesTotal: integer("likes_total"), // TikTok lifetime likes
    views: integer("views"),
    reach: integer("reach"),
    profileViews: integer("profile_views"),
    interactions: integer("interactions"),
    newFollows: integer("new_follows"), // IG follower_count metric = gross new follows that day
    source: text("source").$type<"api" | "manual">().notNull().default("api"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("creator_snapshots_platform_date_uq").on(t.platform, t.date)],
);

/** Latest stats per post/video, refreshed by the daily sync. */
export const creatorMedia = pgTable(
  "creator_media",
  {
    id: text("id").primaryKey(),
    platform: text("platform").$type<CreatorPlatform>().notNull(),
    externalId: text("external_id").notNull(),
    permalink: text("permalink"),
    thumbnailUrl: text("thumbnail_url"),
    caption: text("caption"),
    mediaType: text("media_type"), // reel, carousel, image, video
    postedAt: timestamp("posted_at", { withTimezone: true }),
    views: integer("views"),
    reach: integer("reach"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }), // tag a collab post to a business
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("creator_media_platform_ext_uq").on(t.platform, t.externalId)],
);

/** Audience breakdowns (city/age/gender), captured weekly. Shape: { city: [{key, value}], age: [...], gender: [...] }. */
export const creatorAudience = pgTable("creator_audience", {
  id: text("id").primaryKey(),
  platform: text("platform").$type<CreatorPlatform>().notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  data: jsonb("data").$type<Record<string, Array<{ key: string; value: number }>>>().notNull(),
});

export type CaptureToken = typeof captureTokens.$inferSelect;
export type CreatorSnapshot = typeof creatorSnapshots.$inferSelect;
export type CreatorMedia = typeof creatorMedia.$inferSelect;

/* ───────────────────────── Collab intake (public form) ───────────────────────── */

export const COLLAB_REQUEST_STATUSES = ["new", "reviewing", "accepted", "declined", "spam"] as const;
export type CollabRequestStatus = (typeof COLLAB_REQUEST_STATUSES)[number];

/**
 * A submission from the public "Collab with Nora" form (/collab). Each one also upserts a lead
 * (opportunity "collab") and drops an ask for Nora, so it shows up where she already looks.
 * `answers` keeps the full form payload; the typed columns are what lists need.
 */
export const collabRequests = pgTable(
  "collab_requests",
  {
    id: text("id").primaryKey(),
    businessName: text("business_name").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    city: text("city"),
    instagramHandle: text("instagram_handle"),
    collabType: text("collab_type"),
    compensation: text("compensation"),
    budget: text("budget"),
    timeline: text("timeline"),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<CollabRequestStatus>().notNull().default("new"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    askId: text("ask_id").references(() => asks.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"), // salted hash for rate limiting only
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("collab_requests_status_idx").on(t.status)],
);

export type CollabRequest = typeof collabRequests.$inferSelect;
