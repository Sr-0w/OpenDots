import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, openDatabase, schema } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { loadMessages, resolveReply, saveMessage, toggleReaction } from '../src/conversations/repo.ts';
import { buildTools } from '../src/agents/tools.ts';

beforeAll(async () => { await openDatabase({ memory: true }); });
afterAll(async () => { await closeDatabase(); });

it('persiste une réaction, la retire, et ne réveille le compagnon que pour son propre message', async () => {
  const agent = await createAgent({ name: 'Réactions' });
  const conversationId = await mainConversationId(agent.id);
  await saveMessage(conversationId, { id: 'mine', role: 'user', parts: [{ type: 'text', text: 'Coucou' }] }, { author: 'user' });
  await saveMessage(conversationId, { id: 'theirs', role: 'assistant', parts: [{ type: 'text', text: 'Je suis là.' }], metadata: { agentId: agent.id } }, { author: 'agent', agentId: agent.id });
  expect(await toggleReaction('missing', 'user', '👍')).toBeNull();
  expect((await toggleReaction('mine', 'user', '👍'))?.added).toBe(true);
  const onAgent = await toggleReaction('theirs', 'user', '👍');
  expect(onAgent).toMatchObject({ added: true, reactions: [{ emoji: '👍', actor: 'user' }] });
  const loaded = await loadMessages(conversationId);
  expect(loaded.messages.find((message) => message.id === 'theirs')?.metadata?.reactions).toEqual([{ emoji: '👍', actor: 'user' }]);
  const wakes = (await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, agent.id))).filter((job) => job.type === 'agent.wake');
  expect(wakes).toHaveLength(1);
  expect((wakes[0].payload as { event?: { type?: string } }).event?.type).toBe('reaction');
  expect((wakes[0].payload as { text?: string }).text).toContain('theirs');
  expect((await toggleReaction('theirs', 'user', '👍'))?.added).toBe(false);
  expect((await loadMessages(conversationId)).messages.find((message) => message.id === 'theirs')?.metadata?.reactions).toBeUndefined();
  await expect(toggleReaction('theirs', 'user', 'merci')).rejects.toThrow(/emoji/);
});

it('retient à quel message on répond et laisse le compagnon réagir', async () => {
  const created = await createAgent({ name: 'Réponses' });
  const agent = (await getAgent(created.id))!;
  const conversationId = await mainConversationId(agent.id);
  await saveMessage(conversationId, { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Quelle heure est-il ?' }] }, { author: 'user' });
  const reply = await resolveReply(conversationId, 'question');
  expect(reply).toMatchObject({ messageId: 'question', role: 'user' });
  expect(await resolveReply(conversationId, 'ailleurs')).toBeNull();
  await saveMessage(conversationId, { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Il est tôt.' }], metadata: { replyTo: reply! } }, { author: 'agent', agentId: agent.id });
  const stored = (await loadMessages(conversationId)).messages.find((message) => message.id === 'answer');
  expect(stored?.metadata?.replyTo?.messageId).toBe('question');
  expect(stored?.metadata?.replyTo?.preview).toContain('Quelle heure');
  const tools = buildTools({ agent, conversationId, isMain: true, userTurn: false, depth: 0, tz: 'UTC' });
  expect(tools.react_to_message).toBeDefined();
  expect(tools.text_user).toBeDefined();
  const added = await tools.react_to_message.execute!({ message_id: 'question', emoji: '❤️' }, { toolCallId: 'react', messages: [] } as any);
  expect(added).toMatchObject({ ok: true, added: true });
  const removed = await tools.react_to_message.execute!({ message_id: 'question', emoji: '❤️' }, { toolCallId: 'react-2', messages: [] } as any);
  expect(removed).toMatchObject({ ok: true, added: false });
  let quoted = '';
  const direct = buildTools({
    agent, conversationId, isMain: true, userTurn: true, depth: 0, tz: 'UTC',
    setReplyTo: async (id) => {
      if (!(await resolveReply(conversationId, id))) throw new Error('Message introuvable dans cette conversation.');
      quoted = id;
    },
  });
  const status = await direct.text_user.execute!({ text: 'Je regarde.', reply_to: 'question' }, { toolCallId: 'status', messages: [] } as any);
  expect(status).toMatchObject({ ok: true });
  expect(quoted).toBe('question');
  const missing = await direct.text_user.execute!({ text: 'Hmm.', reply_to: 'inconnu' }, { toolCallId: 'status-2', messages: [] } as any);
  expect(missing).toMatchObject({ ok: false });
});
