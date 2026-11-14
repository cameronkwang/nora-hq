CREATE TABLE "drop_links" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"lang" text,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drop_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "drop_link_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "send_from_kind" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "send_from" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "creator_offer" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "prelaunch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "opening_date" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_sync_status" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_sync_count" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_sync_error" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stats_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stats_source" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "prior_post_url" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "prior_post_found_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drop_links" ADD CONSTRAINT "drop_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drop_links_client_idx" ON "drop_links" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_drop_link_id_drop_links_id_fk" FOREIGN KEY ("drop_link_id") REFERENCES "public"."drop_links"("id") ON DELETE set null ON UPDATE no action;