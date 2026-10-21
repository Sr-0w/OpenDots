import { and, count, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { enqueue } from '../jobs/queue.ts';
import { log } from '../journal.ts';
import { pairConversationId, saveMessage } from '../conversations/repo.ts';
import { newId } from '../util.ts';

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
  await enqueue('team.deliver', { teamMessageId: row.id }, { agentId: input.toAgentId, dedupeKey: `team:${row.id}` });
  publish({ type: 'team.changed', conversationId });
  await log(input.fromAgentId, 'team.sent', `Message envoyé à un compagnon`, { to: input.toAgentId, teamMessageId: row.id });
  return (await getTeamMessage(row.id))!;
}

export async function getTeamMessage(id: string): Promise<TeamMessageRow | null> {
  const [row] = await db().select().from(schema.teamMessages).where(eq(schema.teamMessages.id, id));
  return row ?? null;
}

export async function updateTeamMessage(id: string, patch: Partial<TeamMessageRow>) {
  await db().update(schema.teamMessages).set(patch).where(eq(schema.teamMessages.id, id));
}
