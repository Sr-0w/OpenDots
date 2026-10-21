import { and, count, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { enqueue } from '../jobs/queue.ts';
import { log } from '../journal.ts';
import { pairConversationId, saveMessage } from '../conversations/repo.ts';
import { mainConversationId } from '../agents/repo.ts';
import { newId } from '../util.ts';
import { isPureAck, PAIR_THREAD_CAP } from './policy.ts';

export type TeamMessageRow = typeof schema.teamMessages.$inferSelect;

const HOURLY_LIMIT = 30;

export class TeamError extends Error {}

/** Messagerie interne asynchrone entre compagnons. */
export async function sendTeamMessage(input: {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  expectsReply: boolean;
  replyToConversationId: string | null;
  depth: number;
}): Promise<TeamMessageRow> {
  if (input.fromAgentId === input.toAgentId) throw new TeamError('Un compagnon ne peut pas s’écrire à lui-même.');
  const [{ value: recent }] = await db()
    .select({ value: count() })
    .from(schema.teamMessages)
    .where(and(eq(schema.teamMessages.fromAgentId, input.fromAgentId), gt(schema.teamMessages.createdAt, new Date(Date.now() - 3600_000))));
  if (Number(recent) >= HOURLY_LIMIT) throw new TeamError('Limite de messages internes atteinte pour cette heure.');

  const conversationId = await pairConversationId(input.fromAgentId, input.toAgentId);
  if ((await countThreadMessages(conversationId)) >= PAIR_THREAD_CAP)
    throw new TeamError('Trop d’échanges récents dans ce fil : conclus avec les informations disponibles et informe l’utilisateur.');
  // Un simple accusé de réception n'appelle jamais de réponse (anti ping-pong).
  if (isPureAck(input.content)) input = { ...input, expectsReply: false };
  const row = {
    id: newId('tm'),
    fromAgentId: input.fromAgentId,
    toAgentId: input.toAgentId,
    conversationId,
    content: input.content,
    expectsReply: input.expectsReply,
    replyToConversationId: input.replyToConversationId,
    depth: input.depth,
  };
  await db().insert(schema.teamMessages).values(row);
  await saveMessage(
    conversationId,
    {
      id: newId('msg'),
      role: 'user',
      parts: [{ type: 'text', text: input.content }],
      metadata: { kind: 'team', agentId: input.fromAgentId, createdAt: new Date().toISOString() },
    },
    { author: 'agent', agentId: input.fromAgentId },
  );
  // Envoi depuis un fil entre compagnons : l'utilisateur ne voit pas ce fil, on le signale dans le fil principal.
  if (!input.replyToConversationId) {
    await postTeamNote(input.fromAgentId, input.toAgentId, 'agent_message', 'Message envoyé à', input.content, `msg_snt_${row.id}`);
  }
  await enqueue('team.deliver', { teamMessageId: row.id }, { agentId: input.toAgentId, dedupeKey: `team:${row.id}` });
  publish({ type: 'team.changed', conversationId });
  await log(input.fromAgentId, 'team.sent', `Message envoyé à un compagnon`, { to: input.toAgentId, teamMessageId: row.id });
  return (await getTeamMessage(row.id))!;
}

/**
 * Notice visible dans le fil principal d'un compagnon (carte cliquable vers le fil d'échanges).
 * N'entraîne aucun réveil du modèle.
 */
export async function postTeamNote(
  agentId: string,
  peerAgentId: string,
  type: 'agent_message' | 'agent_reply',
  titlePrefix: string,
  text: string,
  id = newId('msg'),
) {
  const [{ name } = { name: 'un compagnon' }] = await db()
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.id, peerAgentId));
  const conversationId = await mainConversationId(agentId);
  try {
    await saveMessage(
      conversationId,
      {
        id,
        role: 'user',
        parts: [{ type: 'text', text }],
        metadata: {
          kind: 'event',
          agentId,
          createdAt: new Date().toISOString(),
          event: { type, title: `${titlePrefix} ${name}`, fromAgentId: peerAgentId },
        },
      },
      { author: 'event', agentId },
    );
  } catch {
    /* déjà enregistré (nouvelle tentative du job) */
  }
}

/** Messages échangés dans un fil entre deux compagnons durant la dernière heure. */
export async function countThreadMessages(conversationId: string, windowMs = 3600_000): Promise<number> {
  const [{ value }] = await db()
    .select({ value: count() })
    .from(schema.teamMessages)
    .where(and(eq(schema.teamMessages.conversationId, conversationId), gt(schema.teamMessages.createdAt, new Date(Date.now() - windowMs))));
  return Number(value);
}

export async function getTeamMessage(id: string): Promise<TeamMessageRow | null> {
  const [row] = await db().select().from(schema.teamMessages).where(eq(schema.teamMessages.id, id));
  return row ?? null;
}

export async function updateTeamMessage(id: string, patch: Partial<TeamMessageRow>) {
  await db().update(schema.teamMessages).set(patch).where(eq(schema.teamMessages.id, id));
}
