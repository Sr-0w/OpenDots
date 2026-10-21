CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"instructions" text NOT NULL,
	"schedule" jsonb,
	"watch" jsonb,
	"watch_state" jsonb,
	"webhook_token" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_result" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_by" text DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"named" boolean DEFAULT false NOT NULL,
	"color" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"model" jsonb,
	"permissions" jsonb NOT NULL,
	"state" text DEFAULT 'available' NOT NULL,
	"state_detail" text,
	"created_by" text DEFAULT 'user' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"tool_call_id" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"agent_id" text,
	"agent_a" text,
	"agent_b" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"agent_id" text,
	"activity_id" text,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"agent_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journal" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"content" text NOT NULL,
	"kind" text DEFAULT 'fact' NOT NULL,
	"source" text DEFAULT 'conversation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"seq" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"author" text NOT NULL,
	"agent_id" text,
	"parts" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"text_content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"from_agent_id" text NOT NULL,
	"to_agent_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"content" text NOT NULL,
	"expects_reply" boolean DEFAULT true NOT NULL,
	"reply_to_conversation_id" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "activities_due_idx" ON "activities" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_webhook_idx" ON "activities" USING btree ("webhook_token");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_main_idx" ON "conversations" USING btree ("agent_id") WHERE kind = 'main';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_pair_idx" ON "conversations" USING btree ("agent_a","agent_b") WHERE kind = 'pair';--> statement-breakpoint
CREATE UNIQUE INDEX "events_dedupe_idx" ON "events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "journal_agent_idx" ON "journal" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "memories_agent_idx" ON "memories" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "messages_conv_idx" ON "messages" USING btree ("conversation_id","seq");