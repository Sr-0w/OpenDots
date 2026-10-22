import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
let calls = 0;
const greeting = 'Salut ! Je suis ton nouveau compagnon. Quel nom aimerais-tu me donner ?';
vi.mock('../src/models/gateway.ts', () => ({ checkModel: async () => ({ ok: true }), resolveModel: async () => ({ model, providerOptions: {}, label: 'fixture' }) }));
const model = new MockLanguageModelV4({ doStream: async (options) => {
  calls++;
  expect(JSON.stringify(options.prompt)).toContain('Start the conversation yourself now');
  expect(options.tools ?? []).toHaveLength(0);
  return { warnings: [], stream: new ReadableStream({ start(controller) {
    for (const chunk of [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'welcome' }, { type: 'text-delta', id: 'welcome', delta: greeting }, { type: 'text-end', id: 'welcome' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } }]) controller.enqueue(chunk);
    controller.close();
  } }) } as any;
} });
import { createApplication } from '../src/app.ts';
import { withAccount } from '../src/auth/context.ts';
import { authStore, closeAuthStore, createSession, registerUser } from '../src/auth/store.ts';
import { openDatabase, closeAllDatabases, db, schema } from '../src/db/client.ts';
import { getSetting, setOpenRouterKey } from '../src/settings.ts';
import { createAgent, getAgent, listAgentRows, mainConversationId } from '../src/agents/repo.ts';
import { loadMessages, saveMessage } from '../src/conversations/repo.ts';
import { startQueue, stopQueue } from '../src/jobs/queue.ts';
import { registerLifeHandlers } from '../src/life/engine.ts';
import { runTurn } from '../src/agents/turn.ts';
let account: Awaited<ReturnType<typeof registerUser>>, cookie: string;
const app = createApplication(async () => { await openDatabase({ memory: true }); });
const complete = () => app.request('http://localhost/api/onboarding/complete', { method: 'POST', headers: { cookie, origin: 'http://localhost', 'x-opendots-client': '1', 'content-type': 'application/json' }, body: JSON.stringify({ model: { provider: 'openrouter', model: 'fixture' } }) });
beforeAll(async () => {
  await authStore(true); account = await registerUser('welcome@example.com', 'welcome integration password'); cookie = `opendots_session=${await createSession(account.id)}`;
  await withAccount(account, () => openDatabase({ memory: true })); registerLifeHandlers();
});
afterAll(async () => { await withAccount(account, stopQueue); await closeAllDatabases(); await closeAuthStore(); });
it('ne termine pas la configuration sans clé personnelle', async () => {
  expect((await complete()).status).toBe(400);
  expect(await withAccount(account, listAgentRows)).toHaveLength(0);
});
it('engage la conversation sans message utilisateur, une seule fois même après doubles requêtes et rejeu', async () => withAccount(account, async () => {
  await setOpenRouterKey('fixture-personal-key');
  const responses = await Promise.all([complete(), complete()]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  const agents = await listAgentRows(); expect(agents).toHaveLength(1);
  expect(await db().select().from(schema.jobs)).toHaveLength(1);
  expect(await getSetting('onboarding.done')).toBe(true);
  const conversation = await mainConversationId(agents[0].id);
  expect((await loadMessages(conversation)).messages).toHaveLength(0);
  // The durable job starts when the account queue resumes, without a chat POST.
  await startQueue();
  for (let i = 0; i < 200; i++) { if ((await db().select().from(schema.jobs))[0]?.status === 'done') break; await new Promise(r => setTimeout(r, 20)); }
  const messages = (await loadMessages(conversation)).messages;
  expect(messages).toHaveLength(1); expect(messages[0].role).toBe('assistant');
  expect(messages[0].metadata?.setup).toBe(true);
  expect(messages[0].parts.filter(part => part.type === 'text')).toEqual([{ type: 'text', text: greeting, state: 'done' }]);
  expect((await getAgent(agents[0].id))?.state).toBe('available');
  expect((await complete()).status).toBe(200);
  await runTurn(agents[0].id, conversation, { kind: 'onboarding' }).done;
  expect(calls).toBe(1); expect((await loadMessages(conversation)).messages).toHaveLength(1);
}));
it('ne s’intercale pas si l’utilisateur a déjà commencé la conversation', async () => withAccount(account, async () => {
  const agent = await createAgent({ named: false }); const conversation = await mainConversationId(agent.id);
  await saveMessage(conversation, { id: 'already-started', role: 'user', parts: [{ type: 'text', text: 'Bonjour' }] }, { author: 'user' });
  expect((await runTurn(agent.id, conversation, { kind: 'onboarding' }).done).silent).toBe(true);
  expect(calls).toBe(1); expect((await loadMessages(conversation)).messages).toHaveLength(1);
}));
