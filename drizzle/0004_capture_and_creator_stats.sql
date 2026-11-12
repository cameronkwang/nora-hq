CREATE TABLE "capture_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capture_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "creator_audience" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_media" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"permalink" text,
	"thumbnail_url" text,
	"caption" text,
	"media_type" text,
	"posted_at" timestamp with time zone,
	"views" integer,
	"reach" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"client_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"date" text NOT NULL,
	"followers" integer,
	"following" integer,
	"posts" integer,
	"likes_total" integer,
	"views" integer,
	"reach" integer,
	"profile_views" integer,
	"interactions" integer,
	"new_follows" integer,
	"source" text DEFAULT 'api' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "purpose" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_media" ADD CONSTRAINT "creator_media_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_media_platform_ext_uq" ON "creator_media" USING btree ("platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_snapshots_platform_date_uq" ON "creator_snapshots" USING btree ("platform","date");