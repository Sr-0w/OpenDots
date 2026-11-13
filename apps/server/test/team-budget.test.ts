import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { tool } from 'ai';
import { z } from 'zod';
let model: any;
let executed = 0;
vi.mock('../src/models/gateway.ts', () => ({ resolveModel: async () => ({ model, providerOptions: {}, label: 'team-budget' }), requireDesktopVision: async () => {} }));
vi.mock('../src/agents/capability-tools.ts', () => ({ buildCapabilityTools: async () => ({ info: { connectors: ['Gmail [gmail]'], skills: [] }, lazy: { loaded: new Set(), names: new Set(), groups: [] }, tools: { fixture_read: tool({ inputSchema: z.object({}), execute: async () => ({ ok: true, value: `result-${++executed}` }) }) } }) }));
import { openDatabase, closeDatabase } from '../src/db/client.ts';
import { createAgent, mainConversationId } from '../src/agents/repo.ts';
import { runTurn } from '../src/agents/turn.ts';
import { setSetting } from '../src/settings.ts';
import { sendTeamMessage } from '../src/team/service.ts';

beforeAll(async () => {
  await openDatabase({ memory: true });
  await setSetting('engine.turnStepLimit', null);
  await setSetting('engine.teamTurnStepLimit', 2);
});
afterAll(async () => { await closeDatabase(); });

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

it('arrête un tour d’équipe au plafond d’étapes même sans limite générale', async () => {
  executed = 0;
  let calls = 0;
  model = new MockLanguageModelV4({ doStream: async (options: any) => {
    calls++;
    const summary = options.toolChoice?.type === 'none';
    const parts: any[] = [{ type: 'stream-start', warnings: [] }];
    if (summary) parts.push({ type: 'text-start', id: 'summary' }, { type: 'text-delta', id: 'summary', delta: 'Résultat partiel : result-2.' }, { type: 'text-end', id: 'summary' });
    else parts.push({ type: 'tool-call', toolCallId: `read-${calls}`, toolName: 'fixture_read', input: '{}' });
    parts.push({ type: 'finish', finishReason: { unified: summary ? 'stop' : 'tool-calls', raw: summary ? 'stop' : 'tool_calls' }, usage });
    return { warnings: [], stream: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } }) } as any;
  } });
  const sender = await createAgent({ name: 'BudgetSender' });
  const receiver = await createAgent({ name: 'BudgetReceiver' });
  const tm = await sendTeamMessage({ fromAgentId: sender.id, toAgentId: receiver.id, content: 'Compte jusqu’au bout', expectsReply: true, replyToConversationId: await mainConversationId(sender.id), depth: 2 });
  const result = await runTurn(receiver.id, tm.conversationId, { kind: 'team', teamMessageId: tm.id, fromAgentId: sender.id, expectsReply: true, depth: 2 }).done;
  expect(result.error).toBeNull();
  expect(executed).toBe(2);
  expect(calls).toBe(3);
  expect(result.text).toContain('Limite');
  expect(result.text).toContain('2');
  expect(result.text).toContain('compagnons');
});
