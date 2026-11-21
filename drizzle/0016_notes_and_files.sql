CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_files" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"note" text,
	"url" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"sent_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "notes_owner_idx" ON "notes" USING btree ("owner","updated_at");--> statement-breakpoint
CREATE INDEX "shared_files_created_idx" ON "shared_files" USING btree ("created_at");