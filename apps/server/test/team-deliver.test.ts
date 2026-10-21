import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const script: Array<{ text: string; noReply?: boolean }> = [];
const calls: any[] = [];
vi.mock('../src/agents/turn.ts', () => ({
  isAgentBusy: () => false,
  runTurn: (_agentId: string, _conv: string, trigger: any) => {
    calls.push(trigger);
    const r = script.shift() ?? { text: '' };
    return { stream: null, done: Promise.resolve({ messageId: null, text: r.text, silent: false, error: null, noReply: r.noReply ?? false }) };
  },
}));

const { closeDatabase, db, openDatabase, schema } = await import('../src/db/client.ts');
const { createAgent, mainConversationId } = await import('../src/agents/repo.ts');
const { loadMessages } = await import('../src/conversations/repo.ts');
const { registerLifeHandlers } = await import('../src/life/engine.ts');
const { startQueue, stopQueue } = await import('../src/jobs/queue.ts');
const { sendTeamMessage, getTeamMessage } = await import('../src/team/service.ts');
const { sleep } = await import('../src/util.ts');

beforeAll(async () => {
  await openDatabase({ memory: true });
  registerLifeHandlers();
  startQueue();
});
afterAll(async () => {
  await stopQueue();
  await closeDatabase();
});

async function waitAnswered(id: string) {
  for (let i = 0; i < 100; i++) {
    const tm = await getTeamMessage(id);
    if (tm?.status === 'answered' || tm?.status === 'failed') return tm;
    await sleep(50);
  }
  throw new Error('timeout');
}

const titles = async (agentId: string) =>
  (await loadMessages(await mainConversationId(agentId), { limit: 50 })).messages.map((m) => m.metadata?.event?.title).filter(Boolean);

describe('livraison des messages entre compagnons', () => {
  it('relance une fois si le destinataire termine sans répondre, puis réveille l’expéditeur', async () => {
    const a = await createAgent({ name: 'Sender' });
    const b = await createAgent({ name: 'Receiver' });
    script.push({ text: '' }, { text: 'Voici le résultat.' });
    const tm = await sendTeamMessage({ fromAgentId: a.id, toAgentId: b.id, content: 'Peux-tu chercher X ?', expectsReply: true, replyToConversationId: await mainConversationId(a.id), depth: 1 });
    const done = await waitAnswered(tm.id);
    expect(done.reply).toBe('Voici le résultat.');
    expect(calls.filter((c) => c.kind === 'team').map((c) => !!c.nudge)).toEqual([false, true]);
    expect(await titles(b.id)).toEqual(expect.arrayContaining(['Message reçu de Sender', 'Réponse envoyée à Sender']));
    const jobs = await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, a.id));
    expect(jobs.some((j) => j.type === 'agent.wake')).toBe(true);
  });

  it("<no_reply/> ne réveille pas l'expéditeur mais le prévient", async () => {
    const a = await createAgent({ name: 'S2' });
    const b = await createAgent({ name: 'R2' });
    calls.length = 0;
    script.push({ text: '', noReply: true });
    const tm = await sendTeamMessage({ fromAgentId: a.id, toAgentId: b.id, content: 'Pour info, le serveur est à jour, tu as besoin de quelque chose ?', expectsReply: true, replyToConversationId: await mainConversationId(a.id), depth: 1 });
    await waitAnswered(tm.id);
    expect(calls.filter((c) => c.kind === 'team').length).toBe(1);
    expect(await titles(a.id)).toContain('Réponse de R2');
    const jobs = await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, a.id));
    expect(jobs.some((j) => j.type === 'agent.wake')).toBe(false);
  });
});
