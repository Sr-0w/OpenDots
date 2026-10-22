import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { tool, readUIMessageStream } from 'ai';
import { z } from 'zod';
let model: any;
let executed = 0;
vi.mock('../src/models/gateway.ts', () => ({ resolveModel: async () => ({ model, providerOptions: {}, label: 'budget-fixture' }), requireDesktopVision: async () => {} }));
vi.mock('../src/agents/capability-tools.ts', () => ({ buildCapabilityTools: async () => ({ info: { connectors: [], skills: [] }, lazy: { loaded: new Set(), names: new Set(), groups: [] }, tools: { ask_user: tool({ inputSchema: z.object({}), execute: async () => ({ ok: true, status: 'awaiting_user' }) }), fixture_read: tool({ inputSchema: z.object({}), execute: async () => ({ ok: true, value: `result-${++executed}` }) }) } }) }));
import { openDatabase, closeDatabase } from '../src/db/client.ts';
import { createAgent, mainConversationId } from '../src/agents/repo.ts';
import { loadMessages, messageText } from '../src/conversations/repo.ts';
import { runTurn } from '../src/agents/turn.ts';
import { setSetting, getTurnStepLimit } from '../src/settings.ts';
beforeAll(async () => { await openDatabase({ memory: true }); await setSetting('engine.turnStepLimit', 3); });
afterAll(async () => { await closeDatabase(); });
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
for (const empty of [false, true]) it(`lit le dernier résultat, réserve la synthèse et signale la limite (synthèse vide=${empty})`, async () => {
  executed = 0;
  const calls: any[] = [];
  model = new MockLanguageModelV4({ doStream: async (options: any) => {
    calls.push(options);
    const summary = options.toolChoice?.type === 'none';
    const parts: any[] = [{ type: 'stream-start', warnings: [] }];
    if (summary) {
      expect(JSON.stringify(options.prompt)).toContain('result-3');
      if (!empty) parts.push({ type: 'text-start', id: 'summary' }, { type: 'text-delta', id: 'summary', delta: 'Dernier résultat lu : result-3. Il reste du travail.' }, { type: 'text-end', id: 'summary' });
    } else {
      parts.push({ type: 'text-start', id: 'progress' }, { type: 'text-delta', id: 'progress', delta: 'Je consulte.' }, { type: 'text-end', id: 'progress' });
      parts.push({ type: 'tool-call', toolCallId: `read-${calls.length}`, toolName: 'fixture_read', input: '{}' });
    }
    parts.push({ type: 'finish', finishReason: { unified: summary ? 'stop' : 'tool-calls', raw: summary ? 'stop' : 'tool_calls' }, usage });
    return { warnings: [], stream: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } }) } as any;
  } });
  const agent = await createAgent({ name: 'Budget' });
  const conv = await mainConversationId(agent.id);
  const turn = runTurn(agent.id, conv, empty ? { kind: 'event', event: { type: 'schedule', title: 'Longue recherche' }, text: 'Continue une longue recherche', depth: 0 } : { kind: 'user', message: { id: `msg_budget_${empty}`, role: 'user', parts: [{ type: 'text', text: 'Continue une longue recherche' }] } });
  const result = await turn.done;
  expect(result.error).toBeNull();
  expect(result.silent).toBe(false);
  expect(executed).toBe(3);
  expect(calls).toHaveLength(4);
  expect(calls.at(-1).toolChoice).toEqual({ type: 'none' });
  expect(result.text).toContain('Limite');
  expect(result.text).toContain('3');
  if (!empty) expect(result.text).toContain('Dernier résultat lu : result-3');
  const messages = (await loadMessages(conv)).messages;
  expect(messageText(messages.at(-1)!)).toBe(result.text);
  const deltas = turn.stream.chunks.filter((c: any) => c.type === 'text-delta').map((c: any) => c.delta).join('');
  expect(deltas).toContain('Limite');
  const notice = turn.stream.chunks.findIndex((c: any) => c.type === 'text-delta' && c.delta.includes('Limite'));
  expect(notice).toBeLessThan(turn.stream.chunks.findIndex(c => c.type === 'finish'));
  let rendered: any;
  for await (const message of readUIMessageStream({ stream: turn.stream.readable(), terminateOnError: true })) rendered = message;
  expect(messageText(rendered)).toContain('Limite');
});

for (const form of [false, true]) it(`ne force pas la synthèse avant la limite (formulaire=${form})`, async () => {
  executed = 0;
  let calls = 0;
  model = new MockLanguageModelV4({ doStream: async () => {
    calls++;
    const parts: any[] = [{ type: 'stream-start', warnings: [] }];
    if (form) parts.push({ type: 'tool-call', toolCallId: 'question', toolName: 'ask_user', input: '{}' });
    else parts.push({ type: 'text-start', id: 'done' }, { type: 'text-delta', id: 'done', delta: 'Travail terminé.' }, { type: 'text-end', id: 'done' });
    parts.push({ type: 'finish', finishReason: { unified: form ? 'tool-calls' : 'stop', raw: form ? 'tool_calls' : 'stop' }, usage });
    return { warnings: [], stream: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } }) } as any;
  } });
  const agent = await createAgent({ name: 'Early finish' });
  const conv = await mainConversationId(agent.id);
  const turn = runTurn(agent.id, conv, { kind: 'user', message: { id: `msg_early_${form}`, role: 'user', parts: [{ type: 'text', text: 'Test' }] } });
  const result = await turn.done;
  expect(result.error).toBeNull(); expect(calls).toBe(1);
  expect(result.text).not.toContain('Limite');
  expect(turn.stream.chunks.some((c: any) => c.type === 'text-delta' && c.delta.includes('Limite'))).toBe(false);
});


it('poursuit plus de 48 étapes sans plafond configuré, sans forcer une synthèse', async () => {
  await setSetting('engine.turnStepLimit', null);
  expect(await getTurnStepLimit()).toBeNull();
  executed = 0;
  let calls = 0;
  try {
    model = new MockLanguageModelV4({ doStream: async (options: any) => {
      calls++;
      expect(options.toolChoice?.type).not.toBe('none');
      const more = calls <= 55;
      const parts: any[] = [{ type: 'stream-start', warnings: [] }];
      if (more) parts.push({ type: 'tool-call', toolCallId: `long-${calls}`, toolName: 'fixture_read', input: '{}' });
      else parts.push({ type: 'text-start', id: 'done' }, { type: 'text-delta', id: 'done', delta: '55 opérations terminées.' }, { type: 'text-end', id: 'done' });
      parts.push({ type: 'finish', finishReason: { unified: more ? 'tool-calls' : 'stop', raw: more ? 'tool_calls' : 'stop' }, usage });
      return { warnings: [], stream: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } }) } as any;
    } });
    const agent = await createAgent({ name: 'Long task' });
    const conv = await mainConversationId(agent.id);
    const result = await runTurn(agent.id, conv, { kind: 'user', message: { id: 'msg_no_step_limit', role: 'user', parts: [{ type: 'text', text: 'Termine le travail' }] } }).done;
    expect(result.error).toBeNull(); expect(executed).toBe(55); expect(calls).toBe(56);
    expect(result.text).toBe('55 opérations terminées.');
  } finally { await setSetting('engine.turnStepLimit', 3); }
});
