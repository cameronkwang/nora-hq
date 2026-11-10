ALTER TABLE "content_posts" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_posts" ADD COLUMN "ig_container" jsonb;