CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient" text DEFAULT 'nora' NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ask_id" text,
	"client_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_recipient_idx" ON "deliveries" USING btree ("recipient","seen_at");--> statement-breakpoint
CREATE INDEX "deliveries_ask_idx" ON "deliveries" USING btree ("ask_id");