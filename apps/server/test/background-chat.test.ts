import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { tool } from 'ai';
import { z } from 'zod';

let model: any;
let releaseTool: () => void = () => {};
let toolStarted: () => void = () => {};
vi.mock('../src/models/gateway.ts', () => ({ resolveModel: async () => ({ model, providerOptions: {}, label: 'background-fixture' }), requireDesktopVision: async () => {} }));
vi.mock('../src/agents/capability-tools.ts', () => ({
  buildCapabilityTools: async () => ({
    info: { connectors: [], skills: [] },
    lazy: { loaded: new Set(), names: new Set(), groups: [] },
    tools: {
      slow_tool: tool({
        inputSchema: z.object({}),
        execute: async () => {
          toolStarted();
          await new Promise<void>((resolve) => { releaseTool = resolve; });
          return { ok: true, value: 'fait' };
        },
      }),
    },
  }),
}));

import { openDatabase, closeDatabase } from '../src/db/client.ts';
import { createAgent, mainConversationId } from '../src/agents/repo.ts';
import { loadMessages, messageText } from '../src/conversations/repo.ts';
import { runTurn } from '../src/agents/turn.ts';
import { setSetting } from '../src/settings.ts';

beforeAll(async () => { await openDatabase({ memory: true }); await setSetting('engine.turnStepLimit', null); });
afterAll(async () => { await closeDatabase(); });

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function streamOf(parts: any[]) {
  return { warnings: [], stream: new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } }) } as any;
}

it('répond tout de suite et laisse le travail continuer, puis rapporte le résultat', async () => {
  let phase = 'tool';
  const started = new Promise<void>((resolve) => { toolStarted = resolve; });
  model = new MockLanguageModelV4({ doStream: async () => {
    const step = phase;
    if (step === 'tool') {
      phase = 'reply';
      return streamOf([
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'slow', toolName: 'slow_tool', input: '{}' },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
      ]);
    }
    if (step === 'reply') {
      phase = 'resume';
      return streamOf([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'now' },
        { type: 'text-delta', id: 'now', delta: 'Je te réponds pendant que ça continue.' },
        { type: 'text-end', id: 'now' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ]);
    }
    if (step === 'resume') {
      phase = 'report';
      return streamOf([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'done' },
        { type: 'text-delta', id: 'done', delta: 'Le fichier est prêt.' },
        { type: 'text-end', id: 'done' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ]);
    }
    return streamOf([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'report' },
      { type: 'text-delta', id: 'report', delta: 'C’est terminé, le fichier est prêt.' },
      { type: 'text-end', id: 'report' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]);
  } });

  const agent = await createAgent({ name: 'Fond' });
  const conv = await mainConversationId(agent.id);
  const work = runTurn(agent.id, conv, { kind: 'user', message: { id: 'msg_work', role: 'user', parts: [{ type: 'text', text: 'Prépare le fichier' }] } });
  await started;
  const reply = await runTurn(agent.id, conv, { kind: 'user', message: { id: 'msg_reply', role: 'user', parts: [{ type: 'text', text: 'Tu en es où ?' }] } }).done;
  expect(reply.text).toBe('Je te réponds pendant que ça continue.');
  expect(reply.error).toBeNull();
  releaseTool();
  const finished = await work.done;
  expect(finished.text).toContain('Le fichier est prêt.');
  let reported = '';
  for (let n = 0; n < 50 && !reported.includes('C’est terminé'); n++) {
    reported = (await loadMessages(conv)).messages.map((message) => messageText(message)).join('\n');
    if (!reported.includes('C’est terminé')) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(reported).toContain('C’est terminé, le fichier est prêt.');
});
