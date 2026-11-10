CREATE TABLE "ask_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ask_id" text NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_messages_ask_idx" ON "ask_messages" USING btree ("ask_id","created_at");