import { and, asc, count, desc, eq, lt, or } from 'drizzle-orm';
import type { UIMessage } from 'ai';
import type { MessageMetadata, TeamThreadDTO } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { newId } from '../util.ts';

export type OpenDotsUIMessage = UIMessage<MessageMetadata>;

export function messageText(msg: Pick<UIMessage, 'parts'>): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

export async function getConversation(id: string) {
  const [row] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, id));
  return row ?? null;
}

export async function pairConversationId(a: string, b: string): Promise<string> {
  const [agentA, agentB] = [a, b].sort();
  const find = async () => {
    const [row] = await db()
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.kind, 'pair'),
          eq(schema.conversations.agentA, agentA),
          eq(schema.conversations.agentB, agentB),
        ),
      );
    return row?.id ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  await db()
    .insert(schema.conversations)
    .values({ id: newId('cv'), kind: 'pair', agentA, agentB })
    .onConflictDoNothing();
  return (await find())!;
}

export async function saveMessage(
  conversationId: string,
  msg: OpenDotsUIMessage,
  opts: { author: 'user' | 'agent' | 'event'; agentId?: string | null; hidden?: boolean },
) {
  const text = messageText(msg);
  const metadata = { ...(msg.metadata ?? {}), hidden: opts.hidden ?? false };
  const createdAt = metadata.createdAt ? new Date(metadata.createdAt) : new Date();
  await db()
    .insert(schema.messages)
    .values({
      id: msg.id,
      conversationId,
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      author: opts.author,
      agentId: opts.agentId ?? null,
      parts: msg.parts as unknown[],
      metadata: metadata as Record<string, unknown>,
      hidden: opts.hidden ?? false,
      textContent: text,
      createdAt,
    })
    .onConflictDoUpdate({
      target: schema.messages.id,
      set: { parts: msg.parts as unknown[], metadata: metadata as Record<string, unknown>, textContent: text, hidden: opts.hidden ?? false },
    });
  await db().update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, conversationId));
  publish({
    type: 'message.created',
    conversationId,
    agentId: opts.agentId ?? null,
    messageId: msg.id,
    hidden: opts.hidden ?? false,
  });
}

function rowToUI(r: typeof schema.messages.$inferSelect): OpenDotsUIMessage {
  return {
    id: r.id,
    role: r.role,
    parts: r.parts as OpenDotsUIMessage['parts'],
    metadata: { ...(r.metadata as MessageMetadata), createdAt: r.createdAt.toISOString(), hidden: r.hidden },
  };
}

/** Derniers messages d'une conversation, du plus ancien au plus récent. */
export async function loadMessages(
  conversationId: string,
  opts: { limit?: number; includeHidden?: boolean; beforeSeq?: number } = {},
): Promise<{ messages: OpenDotsUIMessage[]; rows: (typeof schema.messages.$inferSelect)[] }> {
  const where = [eq(schema.messages.conversationId, conversationId)];
  if (!opts.includeHidden) where.push(eq(schema.messages.hidden, false));
  if (opts.beforeSeq) where.push(lt(schema.messages.seq, opts.beforeSeq));
  const rows = await db()
    .select()
    .from(schema.messages)
    .where(and(...where))
    .orderBy(desc(schema.messages.seq))
    .limit(opts.limit ?? 200);
  rows.reverse();
  return { messages: rows.map(rowToUI), rows };
}

export async function getMessageRow(id: string) {
  const [row] = await db().select().from(schema.messages).where(eq(schema.messages.id, id));
  return row ?? null;
}

export async function listTeamThreads(): Promise<TeamThreadDTO[]> {
  const convs = await db()
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.kind, 'pair'))
    .orderBy(desc(schema.conversations.updatedAt));
  const out: TeamThreadDTO[] = [];
  for (const c of convs) {
    const [last] = await db()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, c.id))
      .orderBy(desc(schema.messages.seq))
      .limit(1);
    const [{ value }] = await db()
      .select({ value: count() })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, c.id));
    out.push({
      conversationId: c.id,
      agentIds: [c.agentA!, c.agentB!],
      lastMessageAt: last?.createdAt.toISOString() ?? null,
      lastMessagePreview: last?.textContent.slice(0, 140) ?? null,
      messageCount: Number(value),
    });
  }
  return out;
}

export async function threadsForAgent(agentId: string): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.kind, 'pair'), or(eq(schema.conversations.agentA, agentId), eq(schema.conversations.agentB, agentId))))
    .orderBy(asc(schema.conversations.createdAt));
  return rows.map((r) => r.id);
}
