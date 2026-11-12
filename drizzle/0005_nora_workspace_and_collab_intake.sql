CREATE TABLE "collab_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"city" text,
	"instagram_handle" text,
	"collab_type" text,
	"compensation" text,
	"budget" text,
	"timeline" text,
	"answers" jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"lead_id" text,
	"ask_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "kind" text DEFAULT 'business' NOT NULL;--> statement-breakpoint
ALTER TABLE "collab_requests" ADD CONSTRAINT "collab_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_requests" ADD CONSTRAINT "collab_requests_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collab_requests_status_idx" ON "collab_requests" USING btree ("status");