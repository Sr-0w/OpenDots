import { streamText, tool, jsonSchema, isStepCount } from 'ai';
import { describe, expect, it } from 'vitest';
import { codexHome, codexModel, type CodexRpc } from './codex.ts';
import { withAccount } from '../auth/context.ts';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fake(event: any) {
  const calls: any[] = [];
  const rpc = { onMessage: (_: any) => {}, onClose: (_: Error) => {}, closed: false, initialize: async () => {}, close() { this.closed = true; }, send: () => {}, async call(method: string, params: any) { calls.push({ method, params }); if (method === 'thread/start') return { thread: { id: 'thread' } }; queueMicrotask(() => this.onMessage(event)); return {}; } };
  return { rpc, calls, model: codexModel('test', '/tmp/unused', 'medium', () => rpc as unknown as CodexRpc) };
}
async function read(stream: ReadableStream<any>) { const parts = []; const reader = stream.getReader(); while (true) { const { done, value } = await reader.read(); if (done) break; parts.push(value); } return parts; }
describe('Codex adapter', () => {
  it('runs an SDK tool and supplies its result to the next inference step', async () => {
    let step = 0, executed = 0;
    const prompts: any[] = [];
    const model = { ...fake({}).model, async doStream(options: any) {
      prompts.push(options.prompt);
      const event = step++ === 0 ? { method: 'item/tool/call', params: { callId: 'sdk-call', tool: 'lookup', arguments: {} } } : { method: 'turn/completed', params: { turn: {} } };
      return fake(event).model.doStream(options);
    } };
    const result = streamText({ model, prompt: 'Look up the value', tools: { lookup: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => { executed++; return { value: 'verified' }; } }) }, stopWhen: isStepCount(2) });
    for await (const _ of result.stream) { /* consume the real SDK tool loop */ }
    expect(executed).toBe(1); expect(step).toBe(2);
    expect(JSON.stringify(prompts[1])).toContain('verified');
  });

  it('returns dynamic calls to OpenDots rather than executing them in Codex', async () => {
    const { model, rpc, calls } = fake({ method: 'item/tool/call', id: 5, params: { callId: 'call-1', tool: 'computer_action', arguments: { action: 'click', x: 12, y: 15 } } });
    const { stream } = await model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Click' }] }], tools: [{ type: 'function', name: 'computer_action', inputSchema: { type: 'object' } }] });
    const parts = await read(stream);
    expect(parts.find(p => p.type === 'tool-call')).toMatchObject({ toolCallId: 'call-1', toolName: 'computer_action', input: '{"action":"click","x":12,"y":15}' });
    expect(parts.at(-1).finishReason.unified).toBe('tool-calls');
    expect(calls[0].params.dynamicTools[0].name).toBe('computer_action');
    expect(calls[0].params.sandbox).toBe('read-only'); expect(rpc.closed).toBe(true);
  });
  it('forwards images and disables tools for the final synthesis', async () => {
    const { model, calls } = fake({ method: 'turn/completed', params: { turn: {} } });
    const { stream } = await model.doStream({ toolChoice: { type: 'none' }, tools: [{ type: 'function', name: 'shell_exec' }], prompt: [{ role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: new Uint8Array([1,2,3]) }] }] });
    expect((await read(stream)).at(-1).finishReason.unified).toBe('stop');
    expect(calls[0].params.dynamicTools).toEqual([]);
    expect(calls[1].params.input[1]).toEqual({ type: 'image', url: 'data:image/png;base64,AQID' });
  });
  it('rejects invented tools', async () => {
    const { model, rpc } = fake({ method: 'item/tool/call', params: { tool: 'not_allowed' } });
    await expect(read((await model.doStream({ prompt: [], tools: [] })).stream)).rejects.toThrow('inconnu'); expect(rpc.closed).toBe(true);
  });
  it('honors Stop before the turn starts', async () => {
    const { model, rpc, calls } = fake({}); const abort = new AbortController(); abort.abort();
    await expect(read((await model.doStream({ prompt: [], abortSignal: abort.signal })).stream)).rejects.toThrow('arrêté');
    expect(calls).toEqual([]); expect(rpc.closed).toBe(true);
  });
  it('requires an account and isolates credential directories', async () => {
    await expect(codexHome()).rejects.toThrow('utilisateur');
    const root = await mkdtemp(join(tmpdir(), 'codex-homes-'));
    try {
      const a = await withAccount({ id: 'a', email: 'a@test', role: 'user', dataDir: join(root, 'a') }, codexHome);
      const b = await withAccount({ id: 'b', email: 'b@test', role: 'user', dataDir: join(root, 'b') }, codexHome);
      expect(a).not.toBe(b); expect((await stat(a)).mode & 0o777).toBe(0o700);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
