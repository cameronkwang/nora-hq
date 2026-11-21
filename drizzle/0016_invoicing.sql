CREATE SEQUENCE "public"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"billing_address" text,
	"notes" text,
	"client_id" text,
	"lang" text,
	"archived" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"session_id" text NOT NULL,
	"url" text,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"method" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_checkouts_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_on" text NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"fee_cents" integer,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" text,
	"due_date" text,
	"terms_days" integer DEFAULT 14 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"discount_label" text,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"notes" text,
	"private_notes" text,
	"deal_id" text,
	"retainer_id" text,
	"retainer_month" text,
	"token_hash" text,
	"token_enc" text,
	"lang" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_ref" text,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"last_reminded_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "retainers" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"start_month" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_month" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checkouts" ADD CONSTRAINT "invoice_checkouts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_client_uq" ON "customers" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "customers_name_key_idx" ON "customers" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "invoice_checkouts_invoice_idx" ON "invoice_checkouts" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_paid_on_idx" ON "invoice_payments" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_deal_idx" ON "invoices" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_retainer_month_uq" ON "invoices" USING btree ("retainer_id","retainer_month");--> statement-breakpoint
CREATE INDEX "retainers_customer_idx" ON "retainers" USING btree ("customer_id");