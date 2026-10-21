import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  ActivityKind,
  ActivitySchedule,
  ActivityMailFilter,
  ActivityWatch,
  AgentPermissions,
  AskQuestion,
  ConnectorKind,
  AgentState,
  ApprovalStatus,
  ModelConfig,
} from '@opendots/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  named: boolean('named').notNull().default(false),
  color: text('color').notNull(),
  description: text('description').notNull().default(''),
  personality: text('personality').notNull().default(''),
  instructions: text('instructions').notNull().default(''),
  model: jsonb('model').$type<ModelConfig | null>(),
  permissions: jsonb('permissions').$type<AgentPermissions>().notNull(),
  state: text('state').$type<AgentState>().notNull().default('available'),
  stateDetail: text('state_detail'),
  createdBy: text('created_by').notNull().default('user'),
  archived: boolean('archived').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  lastReadAt: ts('last_read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<'main' | 'pair'>().notNull(),
    /** Compagnon propriétaire pour une conversation principale. */
    agentId: text('agent_id'),
    /** Participants d'une conversation entre compagnons (triés). */
    agentA: text('agent_a'),
    agentB: text('agent_b'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_main_idx').on(t.agentId).where(sql`kind = 'main'`),
    uniqueIndex('conversations_pair_idx').on(t.agentA, t.agentB).where(sql`kind = 'pair'`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    seq: serial('seq').primaryKey(),
    id: text('id').notNull().unique(),
    conversationId: text('conversation_id').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    /** user | agent | event */
    author: text('author').$type<'user' | 'agent' | 'event'>().notNull(),
    agentId: text('agent_id'),
    parts: jsonb('parts').$type<unknown[]>().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    hidden: boolean('hidden').notNull().default(false),
    textContent: text('text_content').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_conv_idx').on(t.conversationId, t.seq)],
);

export const memories = pgTable(
  'memories',
  {
    id: text('id').primaryKey(),
    /** null = connaissance partagée entre compagnons. */
    agentId: text('agent_id'),
    content: text('content').notNull(),
    kind: text('kind').notNull().default('fact'),
    source: text('source').notNull().default('conversation'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('memories_agent_idx').on(t.agentId)],
);

export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    title: text('title').notNull(),
    kind: text('kind').$type<ActivityKind>().notNull(),
    instructions: text('instructions').notNull(),
    schedule: jsonb('schedule').$type<ActivitySchedule | null>(),
    watch: jsonb('watch').$type<ActivityWatch | null>(),
    /** Filtre d'un déclencheur mail : compte, expéditeur, sujet. */
    filter: jsonb('filter').$type<ActivityMailFilter | null>(),
    watchState: jsonb('watch_state').$type<{ hash?: string; excerpt?: string; matched?: boolean } | null>(),
    webhookToken: text('webhook_token'),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: ts('next_run_at'),
    lastRunAt: ts('last_run_at'),
    lastStatus: text('last_status'),
    lastResult: text('last_result'),
    runCount: integer('run_count').notNull().default(0),
    createdBy: text('created_by').notNull().default('agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('activities_due_idx').on(t.enabled, t.nextRunAt),
    uniqueIndex('activities_webhook_idx').on(t.webhookToken),
  ],
);

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    agentId: text('agent_id'),
    activityId: text('activity_id'),
    payload: jsonb('payload').notNull(),
    dedupeKey: text('dedupe_key'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('events_dedupe_idx').on(t.dedupeKey)],
);

export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  toolCallId: text('tool_call_id'),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  input: jsonb('input').notNull(),
  status: text('status').$type<ApprovalStatus>().notNull().default('pending'),
  result: jsonb('result'),
  error: text('error'),
  resolvedBy: text('resolved_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

export const teamMessages = pgTable('team_messages', {
  id: text('id').primaryKey(),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  content: text('content').notNull(),
  expectsReply: boolean('expects_reply').notNull().default(true),
  /** Conversation d'origine de l'expéditeur, où la réponse sera rapportée. */
  replyToConversationId: text('reply_to_conversation_id'),
  depth: integer('depth').notNull().default(0),
  status: text('status').$type<'pending' | 'processing' | 'answered' | 'done' | 'failed'>().notNull().default('pending'),
  reply: text('reply'),
  createdAt: ts('created_at').notNull().defaultNow(),
  answeredAt: ts('answered_at'),
});

export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    agentId: text('agent_id'),
    status: text('status').$type<'queued' | 'running' | 'done' | 'failed'>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAt: ts('run_at').notNull().defaultNow(),
    lockedAt: ts('locked_at'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: ts('created_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('jobs_queue_idx').on(t.status, t.runAt), uniqueIndex('jobs_dedupe_idx').on(t.dedupeKey)],
);

export const journal = pgTable(
  'journal',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id'),
    kind: text('kind').notNull(),
    summary: text('summary').notNull(),
    data: jsonb('data'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('journal_agent_idx').on(t.agentId, t.createdAt)],
);

/** Skills : instructions réutilisables, au niveau du compte. */
export const skills = pgTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  instructions: text('instructions').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  pluginId: text('plugin_id'),
  createdBy: text('created_by').notNull().default('user'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Connecteurs : serveurs MCP et comptes mail, au niveau du compte. */
export const connectors = pgTable('connectors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').$type<ConnectorKind>().notNull(),
  config: jsonb('config').$type<Record<string, any>>().notNull(),
  /** Secrets chiffrés (JSON), jamais exposés au frontend ni aux modèles. */
  secret: text('secret'),
  enabled: boolean('enabled').notNull().default(true),
  approval: text('approval').$type<'ask' | 'auto'>().notNull().default('ask'),
  status: text('status').$type<'unknown' | 'ok' | 'error'>().notNull().default('unknown'),
  lastError: text('last_error'),
  tools: jsonb('tools').$type<{ name: string; description: string }[]>(),
  state: jsonb('state').$type<Record<string, any>>(),
  pluginId: text('plugin_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const plugins = pgTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  version: text('version').notNull().default('0.0.0'),
  manifest: jsonb('manifest').notNull(),
  source: text('source').notNull().default('manual'),
  installedAt: ts('installed_at').notNull().defaultNow(),
});

export const mailDrafts = pgTable('mail_drafts', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  connectorId: text('connector_id').notNull(),
  to: jsonb('to').$type<string[]>().notNull(),
  cc: jsonb('cc').$type<string[]>().notNull().default([]),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  inReplyTo: text('in_reply_to'),
  references: text('references'),
  status: text('status').$type<'pending' | 'sent' | 'discarded' | 'failed'>().notNull().default('pending'),
  approvalId: text('approval_id'),
  messageId: text('message_id'),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  sentAt: ts('sent_at'),
});

/** Demandes d'information ou de choix adressées à l'utilisateur. */
export const userRequests = pgTable('user_requests', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  title: text('title').notNull(),
  questions: jsonb('questions').$type<AskQuestion[]>().notNull(),
  status: text('status').$type<'pending' | 'answered' | 'cancelled'>().notNull().default('pending'),
  answers: jsonb('answers').$type<Record<string, unknown>>(),
  createdAt: ts('created_at').notNull().defaultNow(),
  answeredAt: ts('answered_at'),
});
