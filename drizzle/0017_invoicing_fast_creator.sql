ALTER SEQUENCE "public"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 170 CACHE 1;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "terms_days" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pay_ways" jsonb DEFAULT '["zelle"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pay_note" text;--> statement-breakpoint
ALTER TABLE "retainers" ADD COLUMN "contract_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_deal_idx" ON "contracts" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "contracts_customer_idx" ON "contracts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_contract_idx" ON "invoices" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retainers_contract_uq" ON "retainers" USING btree ("contract_id");--> statement-breakpoint
-- Numbers continue Nora's Skynova sequence (7 digits, "0000170" first). START WITH above only records the start;
-- this moves the live sequence: the next number is 170, or past every all-digit number already on an invoice, and
-- never backwards. Neon over HTTP has no transactions: setval is one statement.
SELECT setval('"public"."invoice_number_seq"', greatest(
  170,
  (SELECT coalesce(max("number"::bigint), 0) + 1 FROM "invoices" WHERE "number" ~ '^[0-9]{1,18}$'),
  (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM "public"."invoice_number_seq")
), false);
