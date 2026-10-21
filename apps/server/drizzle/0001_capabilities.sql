CREATE TABLE "connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"approval" text DEFAULT 'ask' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"tools" jsonb,
	"state" jsonb,
	"plugin_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"in_reply_to" text,
	"references" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_id" text,
	"message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '0.0.0' NOT NULL,
	"manifest" jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"plugin_id" text,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"title" text NOT NULL,
	"questions" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "filter" jsonb;