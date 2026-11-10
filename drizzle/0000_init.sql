CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"client_id" text,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asks" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_by" text NOT NULL,
	"claude_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"brand" text,
	"instagram_handle" text,
	"tiktok_handle" text,
	"website" text,
	"google_location" text,
	"brand_voice" text,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"client_id" text,
	"label" text NOT NULL,
	"external_id" text,
	"token_enc" text NOT NULL,
	"scopes" text,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"format" text DEFAULT 'feed' NOT NULL,
	"caption" text,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"status" text DEFAULT 'idea' NOT NULL,
	"publish_mode" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"permalink" text,
	"task_id" text,
	"published_at" timestamp with time zone,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"instagram_handle" text,
	"tiktok_handle" text,
	"email" text,
	"city" text,
	"niche" text,
	"instagram_followers" integer,
	"tiktok_followers" integer,
	"engagement_rate" real,
	"stats_updated_at" timestamp with time zone,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"notes" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"platform" text NOT NULL,
	"target_per_month" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"task_id" text,
	"ask_id" text,
	"created_by" text DEFAULT 'claude' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"month" text NOT NULL,
	"platform" text NOT NULL,
	"views" integer,
	"reach" integer,
	"followers" integer,
	"engagements" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"channel" text NOT NULL,
	"stage" text DEFAULT 'sourced' NOT NULL,
	"comp_type" text DEFAULT 'tbd' NOT NULL,
	"contacted_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"gmail_thread_id" text,
	"post_url" text,
	"disclosure_ok" boolean,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_name" text NOT NULL,
	"rating" integer,
	"reviewer" text,
	"comment" text,
	"create_time" timestamp with time zone,
	"reply_text" text,
	"reply_state" text,
	"policy_violation" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"title" text NOT NULL,
	"details" text,
	"platform" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"assignee" text DEFAULT 'unassigned' NOT NULL,
	"due_date" text,
	"month" text NOT NULL,
	"deliverable_id" text,
	"ask_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_metrics" ADD CONSTRAINT "monthly_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "asks_status_idx" ON "asks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_provider_external_uq" ON "connections" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "posts_client_sched_idx" ON "content_posts" USING btree ("client_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "drafts_status_idx" ON "drafts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_client_month_platform_uq" ON "monthly_metrics" USING btree ("client_id","month","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_client_creator_uq" ON "outreach" USING btree ("client_id","creator_id");--> statement-breakpoint
CREATE INDEX "outreach_stage_idx" ON "outreach" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "reviews_client_idx" ON "reviews" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tasks_client_month_idx" ON "tasks" USING btree ("client_id","month");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");