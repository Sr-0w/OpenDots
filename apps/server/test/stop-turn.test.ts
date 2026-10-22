import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { tool } from 'ai';
import { z } from 'zod';
let model: any, mode = 'text', lastSignal: AbortSignal | undefined, phaseHit = '';
vi.mock('../src/models/gateway.ts', () => ({ resolveModel: async () => ({ model, providerOptions: {}, label: 'fixture' }), requireDesktopVision: async () => {} }));
vi.mock('../src/agents/capability-tools.ts', () => ({ buildCapabilityTools: async (ctx: any) => ({ info: { connectors: [], skills: [] }, lazy: { loaded: new Set(), names: new Set(), groups: [] }, tools: { computer_action: tool({ inputSchema: z.object({}), execute: async (_input, options) => {
 lastSignal = ctx.abortSignal ?? options.abortSignal; phaseHit = 'tool';
 if (mode === 'tool') await new Promise((_resolve, reject) => options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason), {once:true}));
 return mode === 'approval' ? {ok:true,status:'pending_approval',approvalId:'fixture'} : {ok:true};
 }, toModelOutput: async ({ output }) => {
 if (mode === 'image') phaseHit = 'image';
 if (mode === 'image') await new Promise((_resolve,reject) => lastSignal?.addEventListener('abort', () => reject(lastSignal?.reason), {once:true}));
 return {type:'text',value:JSON.stringify(output)};
 } }) } }) }));
import { createApplication } from '../src/app.ts';
import { withAccount } from '../src/auth/context.ts';
import { authStore, closeAuthStore, registerUser, createSession } from '../src/auth/store.ts';
import { openDatabase, closeAllDatabases } from '../src/db/client.ts';
import { createAgent, mainConversationId } from '../src/agents/repo.ts';
import { loadMessages } from '../src/conversations/repo.ts';
import { runTurn } from '../src/agents/turn.ts';
let account: any, cookie: string;
beforeAll(async () => { await authStore(true); account = await registerUser('stop@test.example','isolated stop test password'); cookie = `opendots_session=${await createSession(account.id)}`; await withAccount(account, () => openDatabase({memory:true})); });
afterAll(async () => { await closeAllDatabases(); await closeAuthStore(); });
const usage = { inputTokens: { total:1, noCache:1, cacheRead:0, cacheWrite:0 }, outputTokens:{total:1,text:1,reasoning:0} };
function fixture(finished = false) {
 let count = 0;
 return new MockLanguageModelV4({ doStream: async ({abortSignal}: any) => ({ warnings:[], stream: new ReadableStream({start(controller) {
  controller.enqueue({type:'stream-start',warnings:[]});
  if (!finished && mode !== 'text' && count++ === 0) { controller.enqueue({type:'tool-call',toolCallId:'slow',toolName:'computer_action',input:'{}'}); controller.enqueue({type:'finish',finishReason:{unified:'tool-calls',raw:'tool_calls'},usage}); controller.close(); }
  else { controller.enqueue({type:'text-start',id:'text'}); controller.enqueue({type:'text-delta',id:'text',delta:'Réponse'});
   if (finished) { controller.enqueue({type:'text-end',id:'text'}); controller.enqueue({type:'finish',finishReason:{unified:'stop',raw:'stop'},usage}); controller.close(); }
   else abortSignal.addEventListener('abort',()=>controller.error(abortSignal.reason),{once:true});
  }
 }}) } as any) });
}
for (const phase of ['text','tool','approval','image']) it(`Stop survit pendant ${phase}, finalise les outils et permet un nouveau tour`, async () => withAccount(account, async () => {
 mode=phase; lastSignal=undefined; phaseHit=''; model=fixture();
 const agent=await createAgent({name:`Stop ${phase}`}); const conv=await mainConversationId(agent.id);
 const turn=runTurn(agent.id,conv,{kind:'user',message:{id:`msg_${phase}`,role:'user',parts:[{type:'text',text:'Fais le test'}]}});
 for(let n=0;n<200;n++) { if (phase==='text' ? turn.stream.chunks.some(c=>c.type==='text-delta') : phase==='approval' ? turn.stream.chunks.some(c=>c.type==='tool-output-available') : phaseHit === (phase==='image' ? 'image' : 'tool')) break; await new Promise(r=>setTimeout(r,10)); }
 expect(phase==='text' ? turn.stream.chunks.some(c=>c.type==='text-delta') : phase==='approval' ? turn.stream.chunks.some(c=>c.type==='tool-output-available') : phaseHit === (phase==='image' ? 'image' : 'tool')).toBe(true);
 const app=createApplication(async()=>{});
 const stopped=await app.request('http://localhost/api/agents/'+agent.id+'/stop',{method:'POST',headers:{cookie,origin:'http://localhost','x-opendots-client':'1'}});
 expect(stopped.status).toBe(200); expect(await stopped.json()).toEqual({ok:true,stopped:true});
 await turn.done;
 const history=await loadMessages(conv);
 expect(history.messages.flatMap(m=>m.parts).some((p:any)=>p.type.startsWith('tool-')&&['input-available','input-streaming'].includes(p.state))).toBe(false);
 mode='text'; model=fixture(true); const next=await runTurn(agent.id,conv,{kind:'user',message:{id:`msg_next_${phase}`,role:'user',parts:[{type:'text',text:'Encore'}]}}).done;
 expect(next.error).toBeNull(); expect(next.text).toBe('Réponse'); lastSignal=undefined;
}),20000);
