import { and, asc, count, desc, eq, gt, ne, sql } from 'drizzle-orm';
import {
  DEFAULT_PERMISSIONS,
  type AgentDTO,
  type AgentPermissions,
  type AgentState,
  type ModelConfig,
} from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { getDefaultModel } from '../settings.ts';
import { AGENT_COLORS, newId } from '../util.ts';

export type AgentRow = typeof schema.agents.$inferSelect;

/** Les permissions ajoutées par une version plus récente prennent leur valeur par défaut. */
function normalize(row: AgentRow): AgentRow {
  return { ...row, permissions: { ...DEFAULT_PERMISSIONS, ...row.permissions } };
}

export async function getAgent(id: string): Promise<AgentRow | null> {
  const [row] = await db().select().from(schema.agents).where(eq(schema.agents.id, id));
  return row ? normalize(row) : null;
}

export async function listAgentRows(): Promise<AgentRow[]> {
  const rows = await db()
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.archived, false))
    .orderBy(asc(schema.agents.sortOrder), asc(schema.agents.createdAt));
  return rows.map(normalize);
}

export async function findAgentByName(name: string): Promise<AgentRow | null> {
  const [row] = await db()
    .select()
    .from(schema.agents)
    .where(and(sql`lower(${schema.agents.name}) = lower(${name.trim()})`, eq(schema.agents.archived, false)));
  return row ? normalize(row) : null;
}

/** Résout un compagnon à partir d'un identifiant ou d'un nom. */
export async function resolveAgentRef(ref: string): Promise<AgentRow | null> {
  return (await getAgent(ref)) ?? (await findAgentByName(ref));
}

export async function mainConversationId(agentId: string): Promise<string> {
  const [row] = await db()
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.kind, 'main'), eq(schema.conversations.agentId, agentId)));
  if (row) return row.id;
  const id = newId('cv');
  await db().insert(schema.conversations).values({ id, kind: 'main', agentId }).onConflictDoNothing();
  return (await mainConversationId(agentId)) ?? id;
}

export async function createAgent(input: {
  name?: string;
  named?: boolean;
  description?: string;
  personality?: string;
  instructions?: string;
  model?: ModelConfig | null;
  permissions?: Partial<AgentPermissions>;
  createdBy?: string;
  color?: string;
}): Promise<AgentRow> {
  const existing = await listAgentRows();
  const id = newId('ag');
  const row = {
    id,
    name: input.name?.trim() || 'Compagnon',
    named: input.named ?? Boolean(input.name),
    color: input.color ?? AGENT_COLORS[existing.length % AGENT_COLORS.length],
    description: input.description ?? '',
    personality: input.personality ?? '',
    instructions: input.instructions ?? '',
    model: input.model ?? null,
    permissions: { ...DEFAULT_PERMISSIONS, ...input.permissions },
    createdBy: input.createdBy ?? 'user',
    sortOrder: existing.length,
  };
  await db().insert(schema.agents).values(row);
  await mainConversationId(id);
  const created = (await getAgent(id))!;
  publish({ type: 'agent.created', agent: await toAgentDTO(created) });
  return created;
}

export async function updateAgent(id: string, patch: Partial<Omit<AgentRow, 'id' | 'createdAt'>>): Promise<AgentRow> {
  await db()
    .update(schema.agents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.agents.id, id));
  const row = (await getAgent(id))!;
  publish({ type: 'agent.updated', agent: await toAgentDTO(row) });
  return row;
}

export async function setAgentState(id: string, state: AgentState, detail: string | null = null) {
  await db().update(schema.agents).set({ state, stateDetail: detail }).where(eq(schema.agents.id, id));
  publish({ type: 'agent.state', agentId: id, state, detail });
}

export async function effectiveModel(row: AgentRow): Promise<ModelConfig> {
  return row.model ?? (await getDefaultModel());
}

export async function toAgentDTO(row: AgentRow): Promise<AgentDTO> {
  const convId = await mainConversationId(row.id);
  const [last] = await db()
    .select({ text: schema.messages.textContent, createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, convId), eq(schema.messages.hidden, false)))
    .orderBy(desc(schema.messages.seq))
    .limit(1);
  const unreadWhere = [
    eq(schema.messages.conversationId, convId),
    eq(schema.messages.hidden, false),
    ne(schema.messages.author, 'user'),
    eq(schema.messages.role, 'assistant'),
  ];
  if (row.lastReadAt) unreadWhere.push(gt(schema.messages.createdAt, row.lastReadAt));
  const [{ value: unread }] = await db()
    .select({ value: count() })
    .from(schema.messages)
    .where(and(...unreadWhere));
  return {
    id: row.id,
    name: row.name,
    named: row.named,
    color: row.color,
    description: row.description,
    personality: row.personality,
    instructions: row.instructions,
    model: row.model,
    effectiveModel: await effectiveModel(row),
    permissions: { ...DEFAULT_PERMISSIONS, ...row.permissions },
    state: row.state,
    stateDetail: row.stateDetail,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: last?.createdAt.toISOString() ?? null,
    lastMessagePreview: last?.text.slice(0, 140) ?? null,
    unread: Number(unread),
    mainConversationId: convId,
    archived: row.archived,
  };
}

export async function listAgents(): Promise<AgentDTO[]> {
  const rows = await listAgentRows();
  return Promise.all(rows.map(toAgentDTO));
}
