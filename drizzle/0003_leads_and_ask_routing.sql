CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"category" text,
	"website" text,
	"instagram_handle" text,
	"tiktok_handle" text,
	"google_maps_url" text,
	"google_rating" real,
	"google_review_count" integer,
	"reply_rate" integer,
	"instagram_followers" integer,
	"last_post_at" timestamp with time zone,
	"opportunities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer,
	"why" text,
	"stage" text DEFAULT 'found' NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"next_step_at" text,
	"notes" text,
	"source" text,
	"converted_client_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "kind" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "for_who" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_client_id_clients_id_fk" FOREIGN KEY ("converted_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage");