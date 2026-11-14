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

export const PLATFORMS = ["instagram", "facebook", "tiktok", "google", "email", "other"] as const;
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
  /** Where approved external monthly reports are emailed. Owners only ever receive what we send. */
  ownerEmail: text("owner_email"),
  /** Where to look for creators to feature this business, e.g. "Richmond, VA; 757 / Hampton Roads". */
  outreachAreas: text("outreach_areas"),
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

/* ───────────────────────── Collab deals (Nora's creator business) ───────────────────────── */

export const DEAL_STATUSES = ["planning", "scheduled", "shot", "posted", "complete", "cancelled"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const DEAL_COMP = ["paid", "paid_hosted", "gifted", "affiliate"] as const;
export type DealComp = (typeof DEAL_COMP)[number];
export const PAYMENT_STATUSES = ["not_requested", "requested", "paid", "not_applicable"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type ShotItem = { id: string; text: string; done: boolean };

/** An agreed collab: terms, the visit/shoot, deliverables and whether Nora has been paid. */
export const deals = pgTable(
  "deals",
  {
    id: text("id").primaryKey(),
    businessName: text("business_name").notNull(),
    collabRequestId: text("collab_request_id").references(() => collabRequests.id, { onDelete: "set null" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }), // when the business is also a managed client
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    address: text("address"),
    compType: text("comp_type").$type<DealComp>().notNull().default("paid"),
    amountCents: integer("amount_cents"), // agreed fee
    usageRights: text("usage_rights"), // organic only / repost / paid ads (priced separately)
    terms: text("terms"),
    visitAt: timestamp("visit_at", { withTimezone: true }), // visit or shoot time
    status: text("status").$type<DealStatus>().notNull().default("planning"),
    paymentStatus: text("payment_status").$type<PaymentStatus>().notNull().default("not_requested"),
    paymentDueDate: text("payment_due_date"), // "YYYY-MM-DD"
    paidAt: timestamp("paid_at", { withTimezone: true }),
    menuNotes: text("menu_notes"), // signature dishes, what to order
    dietaryNotes: text("dietary_notes"),
    filmingNotes: text("filming_notes"), // restrictions, best times
    shotList: jsonb("shot_list").$type<ShotItem[]>().notNull().default([]),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deals_status_idx").on(t.status), index("deals_visit_idx").on(t.visitAt)],
);

export const DELIVERABLE_KINDS = ["ig_reel", "ig_post", "ig_story", "tiktok", "photos", "other"] as const;

export const dealDeliverables = pgTable(
  "deal_deliverables",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
    kind: text("kind").$type<(typeof DELIVERABLE_KINDS)[number]>().notNull(),
    dueDate: text("due_date"), // "YYYY-MM-DD"
    postUrl: text("post_url"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    disclosureOk: boolean("disclosure_ok"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("deal_deliverables_deal_idx").on(t.dealId)],
);

/* ───────────────────────── Phone notifications & calendar feeds ───────────────────────── */

export const NOTIFY_TOPICS = ["collab_request", "ask_for_me", "drafts_waiting", "payment_overdue", "visit_reminder"] as const;
export type NotifyTopic = (typeof NOTIFY_TOPICS)[number];

/** Web Push subscriptions (one per device). iOS only allows these from a Home Screen web app. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  topics: jsonb("topics").$type<NotifyTopic[]>().notNull().default(["collab_request", "ask_for_me", "drafts_waiting", "payment_overdue", "visit_reminder"]),
  userAgent: text("user_agent"),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Private iCal subscription links (token stored hashed). */
export const calendarFeeds = pgTable("calendar_feeds", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── Saved replies ───────────────────────── */

/** One-tap message templates. {name}, {business}, {date} placeholders. Claude may only add "suggested" ones. */
export const savedReplies = pgTable("saved_replies", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category"), // collab, client, outreach, general
  status: text("status").$type<"active" | "suggested">().notNull().default("active"),
  useCount: integer("use_count").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── Monthly client reports ───────────────────────── */

/**
 * Two reports per business per month: "internal" (for Cameron & Nora — everything, incl. effort, issues,
 * pending work) and "external" (polished, owner-facing). Owners only ever receive an approved external report
 * that a person sends. External reports go through the drafts approval flow (drafts.kind "report", meta.reportId).
 */
export const clientReports = pgTable(
  "client_reports",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    audience: text("audience").$type<"internal" | "external">().notNull(),
    body: text("body").notNull(), // markdown
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}), // snapshot the numbers were based on
    status: text("status").$type<"draft" | "approved" | "sent">().notNull().default("draft"),
    draftId: text("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentTo: text("sent_to"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("client_reports_client_month_audience_uq").on(t.clientId, t.month, t.audience)],
);

/* ───────────────────────── App settings (key/value) ───────────────────────── */

/** Small settings blobs, e.g. "media_kit" → { enabled, rateLine, showRates, showPastCollabs, pastCollabs, bio }. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Deal = typeof deals.$inferSelect;
export type DealDeliverable = typeof dealDeliverables.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type SavedReply = typeof savedReplies.$inferSelect;
export type ClientReport = typeof clientReports.$inferSelect;

/* ───────────────────────── Sign-in protection ───────────────────────── */

/** Failed sign-ins, for lockout. IPs are stored only as a salted hash. Rows older than 7 days are pruned. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    ipHash: text("ip_hash").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_idx").on(t.ipHash, t.createdAt), index("login_attempts_email_idx").on(t.email, t.createdAt)],
);

/* ───────────────────────── Client onboarding form (private link per client) ───────────────────────── */

export const INTAKE_STATUSES = ["sent", "opened", "submitted", "revoked"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];
export const INTAKE_LANGS = ["en", "zh-Hans", "zh-Hant"] as const;
export type IntakeLang = (typeof INTAKE_LANGS)[number];

/**
 * A private onboarding-form link sent to one client. The raw token is never stored: tokenHash (sha256) is used
 * for lookup and tokenEnc (lib/crypto) lets Cameron/Nora re-copy the link later. answers = the full submission.
 */
export const clientIntakes = pgTable(
  "client_intakes",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    tokenEnc: text("token_enc").notNull(),
    status: text("status").$type<IntakeStatus>().notNull().default("sent"),
    lang: text("lang").$type<IntakeLang>(), // language the client used
    answers: jsonb("answers").$type<Record<string, unknown>>(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("client_intakes_client_idx").on(t.clientId)],
);

export type ClientIntake = typeof clientIntakes.$inferSelect;

/* ───────────────────────── Nora's schedule ───────────────────────── */

/**
 * Nora's jobs: monthly client work and collab visits. Money is deliberately NOT stored (pasted lists may
 * contain amounts, payment methods and 🚩 owed flags — the importer reads and drops them).
 * date = "YYYY-MM-DD" when the day is known; month = "YYYY-MM" always (day "XX" → date null).
 */
export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: text("id").primaryKey(),
    month: text("month").notNull(),
    date: text("date"),
    businessName: text("business_name").notNull(),
    nameKey: text("name_key").notNull(), // normalized name for de-duping re-imports
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    dealId: text("deal_id").references(() => deals.id, { onDelete: "set null" }),
    isFree: boolean("is_free").notNull().default(false),
    needsReel: boolean("needs_reel").notNull().default(false), // 📸 in Nora's list = a reel to post
    reelPostedAt: timestamp("reel_posted_at", { withTimezone: true }),
    notes: text("notes"),
    source: text("source").$type<"paste" | "manual" | "claude">().notNull().default("manual"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("schedule_items_month_name_uq").on(t.month, t.nameKey), index("schedule_items_date_idx").on(t.date)],
);

export type ScheduleItem = typeof scheduleItems.$inferSelect;
