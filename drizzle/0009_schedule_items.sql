CREATE TABLE "schedule_items" (
	"id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"date" text,
	"business_name" text NOT NULL,
	"name_key" text NOT NULL,
	"client_id" text,
	"deal_id" text,
	"is_free" boolean DEFAULT false NOT NULL,
	"needs_reel" boolean DEFAULT false NOT NULL,
	"reel_posted_at" timestamp with time zone,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_items_month_name_uq" ON "schedule_items" USING btree ("month","name_key");--> statement-breakpoint
CREATE INDEX "schedule_items_date_idx" ON "schedule_items" USING btree ("date");