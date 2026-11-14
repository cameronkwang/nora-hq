ALTER TABLE "drop_links" ADD COLUMN "hour_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drop_links" ADD COLUMN "hour_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drop_links" ADD COLUMN "day_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drop_links" ADD COLUMN "day_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drop_links" ADD COLUMN "upload_day" text;--> statement-breakpoint
ALTER TABLE "drop_links" ADD COLUMN "upload_count" integer DEFAULT 0 NOT NULL;