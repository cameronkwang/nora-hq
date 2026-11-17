CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"client_business" text NOT NULL,
	"client_contact" text,
	"agreement_date" text,
	"fee_cents" integer,
	"deal_id" text,
	"fields" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_created_idx" ON "contracts" USING btree ("created_at");