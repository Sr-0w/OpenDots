import { beforeEach, expect, it, vi } from 'vitest';
import { asSchema, convertToModelMessages, generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
const state = vi.hoisted(() => ({ ask: false, action: vi.fn(async () => ({ ok: true, action: 'type' })), shot: vi.fn(async () => ({ ok: true, screenshotId: 'a'.repeat(32), frameHash: 'stable-desktop-pixels', width: 1280, height: 800 })), approval: vi.fn(async () => ({ id: 'approval' })) }));
vi.mock('../src/computer/desktop.ts', async (original) => ({ ...await original<any>(), desktopEnabled: async () => true, humanControl: async () => false, desktopAction: state.action, screenshot: state.shot, readScreenshot: async () => Buffer.from('png-fixture') }));
vi.mock('../src/agents/repo.ts', () => ({ getAgent: async () => ({ id: 'ag_test', archived: false, permissions: { computer: true } }) }));
vi.mock('../src/computer/permissions.ts', () => ({ desktopActionNeedsApproval: async () => state.ask }));
vi.mock('../src/approvals/service.ts', () => ({ registerApprovalAction: () => {}, createApproval: state.approval }));
import { desktopTools } from '../src/computer/tools.ts';
import { desktopVisionMessages } from '../src/computer/vision.ts';
const ctx = { agent: { id: 'ag_test', permissions: { computer: true } }, conversationId: 'cv_test' } as any;
const options = { toolCallId: 'call', messages: [] } as any;
const input = { action: 'type', text: 'https://example.com', submit: true, reason: 'Ouvrir' };
beforeEach(() => { vi.clearAllMocks(); state.ask = false; });
it('publie un schéma plat sans union et tolère les anciens arguments tout en validant chaque action', async () => {
 const tools = await desktopTools(ctx), schema: any = await asSchema(tools.computer_action.inputSchema).jsonSchema;
 expect(schema.required).toEqual(['action', 'reason']);
 expect(JSON.stringify(schema)).not.toMatch(/oneOf|anyOf/);
 expect(Object.values(schema.properties).every((p: any) => p.type !== 'object')).toBe(true);
 await tools.computer_screenshot.execute!({}, options);
 const click = { action: 'click', x: 617, y: 769 };
 expect((await tools.computer_action.execute!({ ...click, reason: 'Cible' }, options) as any).status).toBe('executed');
 expect((await tools.computer_action.execute!({ action: JSON.stringify(click), reason: 'Cible' }, options) as any).status).toBe('executed');
 expect((await tools.computer_action.execute!({ action: click, reason: 'Cible' }, options) as any).status).toBe('blocked_repeat');
 for (const invalid of [{ action: 'click', reason: 'x manque' }, { action: 'unknown', reason: 'Inconnu' }, { action: '{bad', reason: 'JSON invalide' }]) {
   expect((await tools.computer_action.execute!(invalid, options) as any).status).toBe('invalid_input');
 }
 expect(state.action).toHaveBeenCalledTimes(2);
 expect((await tools.computer_action.execute!({ action: { action: 'key', key: 'Tab' }, reason: 'Ancienne forme' }, options) as any).status).toBe('executed');
});
it('observe un bureau actuel avant d’agir puis joint une image après l’action', async () => {
 const tools = await desktopTools(ctx);
 expect((await tools.computer_action.execute!(input as any, options) as any).status).toBe('observe_first');
 expect(state.action).not.toHaveBeenCalled();
 const result: any = await tools.computer_action.execute!(input as any, options);
 expect(result.status).toBe('executed');
 expect(result.visualChange).toBe('unchanged');
 expect(result.note).toContain('ne déduis pas un succès');
 expect(state.action).toHaveBeenCalledWith({ action: 'type', text: input.text, submit: true }, undefined);
 const output: any = await tools.computer_action.toModelOutput!({ output: result } as any);
 expect(output.value.find((part: any) => part.type === 'text').text).toContain('ne déduis pas un succès');
 expect(output.value.some((part: any) => part.type === 'file' && part.mediaType === 'image/png')).toBe(true);
});
it('bloque la troisième action identique pendant le tour', async () => {
 const tools = await desktopTools(ctx); await tools.computer_screenshot.execute!({}, options);
 await tools.computer_action.execute!(input as any, options); await tools.computer_action.execute!(input as any, options);
 expect((await tools.computer_action.execute!(input as any, options) as any).status).toBe('blocked_repeat');
 expect(state.action).toHaveBeenCalledTimes(2);
});
it('ne capture rien pour une approbation en attente', async () => {
 state.ask = true; const tools = await desktopTools(ctx);
 const output: any = await tools.computer_action.execute!(input as any, options);
 expect(output.status).toBe('pending_approval'); expect(state.shot).not.toHaveBeenCalled(); expect(state.action).not.toHaveBeenCalled();
 expect((await tools.computer_action.toModelOutput!({ output } as any)).type).toBe('text');
});
it('une capture indisponible ne prétend pas annuler une action déjà exécutée', async () => {
 const tools = await desktopTools(ctx); await tools.computer_screenshot.execute!({}, options);
 state.shot.mockRejectedValueOnce(new Error('capture failed'));
 const output: any = await tools.computer_action.execute!(input as any, options);
 expect(output).toMatchObject({ ok: true, status: 'executed', screenshot: 'unavailable' });
 expect((await tools.computer_action.execute!(input as any, options) as any).status).toBe('observe_first');
 expect(state.action).toHaveBeenCalledTimes(1);
});
it('envoie les images au format user OpenRouter et conserve seulement les deux dernières', async () => {
 const tools = await desktopTools(ctx);
 const parts = [1,2,3].flatMap((n) => [{ type: 'tool-computer_screenshot', toolCallId: `screen${n}`, state: 'output-available', input: {}, output: { ok: true, screenshotId: 'a'.repeat(32), width: 1280, height: 800 } }]);
 const messages = await convertToModelMessages([{ role: 'assistant', parts } as any], { tools });
 const converted = desktopVisionMessages(messages);
 expect(desktopVisionMessages(converted)).toEqual(converted);
 const next = desktopVisionMessages([...converted, ...messages]);
 expect(next.filter(m => m.role === 'user')).toHaveLength(2);
 expect(converted.filter((m) => m.role === 'user')).toHaveLength(2);
 expect(JSON.stringify(converted.filter((m) => m.role === 'tool'))).not.toContain('"type":"file"');
 let sent: any;
 const model = createOpenRouter({ apiKey: 'fixture', fetch: async (_url, init) => {
 sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id:'x', created:1, model:'fixture', choices:[{finish_reason:'stop',message:{role:'assistant',content:'Vu'}}], usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2} }), {headers:{'content-type':'application/json'}});
 } }).chat('fixture');
 await generateText({model,messages:converted});
 expect(sent.messages.filter((m: any) => m.role === 'user').flatMap((m:any) => m.content).filter((p:any) => p.type === 'image_url')).toHaveLength(2);
 expect(JSON.stringify(sent.messages.filter((m:any) => m.role === 'tool'))).not.toContain('image_url');
});
