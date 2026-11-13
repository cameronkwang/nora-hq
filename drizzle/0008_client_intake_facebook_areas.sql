CREATE TABLE "client_intakes" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"lang" text,
	"answers" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "client_intakes_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "outreach_areas" text;--> statement-breakpoint
ALTER TABLE "client_intakes" ADD CONSTRAINT "client_intakes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_intakes_client_idx" ON "client_intakes" USING btree ("client_id");