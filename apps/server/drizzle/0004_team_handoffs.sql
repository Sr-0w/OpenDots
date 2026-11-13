CREATE TABLE "team_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text,
	"pair_conversation_id" text NOT NULL,
	"main_conversation_id" text NOT NULL,
	"team_message_id" text NOT NULL,
	"from_agent_id" text NOT NULL,
	"task" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"expects_reply" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "team_handoffs_agent_idx" ON "team_handoffs" USING btree ("agent_id","status");
--> statement-breakpoint
CREATE INDEX "team_handoffs_ref_idx" ON "team_handoffs" USING btree ("kind","ref_id");
