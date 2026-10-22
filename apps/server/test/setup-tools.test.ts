import { afterAll, beforeAll, expect, it } from 'vitest';
import { asSchema } from 'ai';
import { openDatabase, closeDatabase } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { buildCapabilityTools } from '../src/agents/capability-tools.ts';
import { createConnector } from '../src/connectors/repo.ts';
const options = { toolCallId: 'setup', messages: [] } as any;
let ctx: any;
beforeAll(async () => { await openDatabase({ memory: true }); const agent = await createAgent({ named: false }); ctx = { agent, conversationId: await mainConversationId(agent.id), isMain: true, userTurn: true, depth: 0, tz: 'UTC' }; });
afterAll(closeDatabase);
it('expose les services connectables même sans aucun compte et produit une carte Gmail pour envoyer', async () => {
  const { tools, info } = await buildCapabilityTools(ctx);
  const context = info.connectors.join('\n');
  for (const service of ['Gmail', 'Google Calendar', 'Google Drive', 'GitHub', 'Outlook', 'IMAP']) expect(context).toContain(service);
  expect(context).toContain('ne signifie PAS connecté'); expect(context).toContain('permissions=[send]');
  const input = { kind: 'integration', provider: 'gmail', permissions: ['send'], reason: 'Envoyer ton message avec Gmail' };
  expect((await asSchema(tools.connection_request_setup.inputSchema).validate!(input)).success).toBe(true);
  expect(await tools.connection_request_setup.execute!(input as any, options)).toMatchObject({ ok: true, status: 'setup_requested', ...input });
  expect((await asSchema(tools.connection_request_setup.inputSchema).validate!({ ...input, permissions: ['admin'] })).success).toBe(false);
});
it('décrit un compte Gmail en lecture seule afin de demander les accès manquants', async () => {
  await createConnector({ kind: 'integration', name: 'Gmail lecture', config: { provider: 'gmail', account: { id: 'fixture', label: 'fixture' }, permissions: ['read'], grantedScopes: [] } });
  const { info } = await buildCapabilityTools(ctx);
  expect(info.connectors.join('\n')).toMatch(/Gmail lecture.*provider=gmail.*accès=read/);
});
it('proposer l’ordinateur ne démarre rien et n’accorde aucune permission', async () => {
  const { tools } = await buildCapabilityTools(ctx);
  expect(await tools.computer_request_setup.execute!({ reason: 'Utiliser une application' }, options)).toMatchObject({ ok: true, status: 'setup_requested' });
  expect((await getAgent(ctx.agent.id))?.permissions.computer).toBe(false);
});
