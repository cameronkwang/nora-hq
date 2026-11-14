ALTER TABLE "client_intakes" ADD COLUMN "upload_day" text;--> statement-breakpoint
ALTER TABLE "client_intakes" ADD COLUMN "upload_count" integer DEFAULT 0 NOT NULL;