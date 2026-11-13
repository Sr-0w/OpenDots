import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, openDatabase, schema } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { buildTools } from '../src/agents/tools.ts';
import { buildCapabilityTools } from '../src/agents/capability-tools.ts';
import { getApproval, resolveApproval } from '../src/approvals/service.ts';
import { loadMessages } from '../src/conversations/repo.ts';
import { deliverTeamResult } from '../src/life/engine.ts';
import { DEFAULT_TEAM_TURN_STEPS, DEFAULT_TEAM_TURN_TIMEOUT_SEC, getTeamTurnStepLimit, getTeamTurnTimeoutMs, setSetting } from '../src/settings.ts';
import { sendTeamMessage } from '../src/team/service.ts';
import { holdForUser, type TeamDelegation } from '../src/team/handoff.ts';

beforeAll(async () => { await openDatabase({ memory: true }); });
afterAll(async () => { await closeDatabase(); });

async function delegated(depth: number, task: string) {
  const sender = (await getAgent((await createAgent({ name: `Ari${depth}${Math.random().toString(36).slice(2, 6)}` })).id))!;
  const receiver = (await getAgent((await createAgent({ name: `Dev${depth}${Math.random().toString(36).slice(2, 6)}` })).id))!;
  const main = await mainConversationId(sender.id);
  const tm = await sendTeamMessage({ fromAgentId: sender.id, toAgentId: receiver.id, content: task, expectsReply: true, replyToConversationId: main, depth });
  const delegation: TeamDelegation = {
    teamMessageId: tm.id,
    fromAgentId: sender.id,
    fromName: sender.name,
    task,
    depth,
    expectsReply: true,
    pairConversationId: tm.conversationId,
    mainConversationId: await mainConversationId(receiver.id),
  };
  return { sender, receiver, tm, delegation, main };
}

function toolCtx(agent: Awaited<ReturnType<typeof getAgent>> & object, delegation: TeamDelegation) {
  return { agent: agent as NonNullable<typeof agent>, conversationId: delegation.pairConversationId, isMain: false, userTurn: false, depth: delegation.depth, tz: 'UTC', peerAgentId: delegation.fromAgentId, teamTurn: true, delegation };
}

describe('validations pendant un échange entre compagnons', () => {
  it('affiche la carte dans le fil principal, avec qui a délégué et pourquoi', async () => {
    const { sender, receiver, delegation } = await delegated(4, 'cherche le tarif du papier');
    const tools = buildTools(toolCtx(receiver, delegation));
    expect(tools.approval_respond).toBeUndefined();
    expect(tools.agent_update_instructions).toBeUndefined();
    expect(tools.agent_update_permissions).toBeUndefined();
    const out: any = await tools.agent_update_profile.execute!({ color: '#112233' } as any, { toolCallId: 'profile', messages: [] } as any);
    expect(out.status).toBe('pending_approval');
    expect((await getAgent(receiver.id))?.color).not.toBe('#112233');
    const approval = await getApproval(out.approvalId);
    expect(approval?.summary).toContain(sender.name);
    expect(approval?.summary).toContain('cherche le tarif du papier');
    const { messages } = await loadMessages(delegation.mainConversationId);
    const card = messages.find((m) => JSON.stringify(m.parts).includes(out.approvalId));
    expect(card?.metadata?.kind).toBe('chat');
    expect(card?.role).toBe('assistant');
    const text = card?.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
    expect(text).toContain(sender.name);
    expect(text).toContain('cherche le tarif du papier');
    expect(text).toContain(receiver.name);
    const listed = await db().select().from(schema.approvals).where(eq(schema.approvals.id, out.approvalId));
    expect(listed[0]?.status).toBe('pending');
    const tm = (await db().select().from(schema.teamMessages).where(eq(schema.teamMessages.id, delegation.teamMessageId)))[0]!;
    expect(await holdForUser(tm, 'J’attends ta validation.')).toBe(true);
    const senderNotes = await loadMessages(await mainConversationId(sender.id));
    expect(senderNotes.messages.some((m) => JSON.stringify(m.parts).includes('attend l’utilisateur'))).toBe(true);
    const premature = (await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, sender.id))).filter((job) => job.type === 'agent.wake');
    expect(premature).toHaveLength(0);
  });

  it('reprend le fil d’équipe à la profondeur d’origine après la décision', async () => {
    const { receiver, delegation, tm } = await delegated(4, 'change ta couleur en bleu');
    const tools = buildTools(toolCtx(receiver, delegation));
    const out: any = await tools.agent_update_profile.execute!({ color: '#0000ff' } as any, { toolCallId: 'resume', messages: [] } as any);
    const row = await resolveApproval(out.approvalId, 'approve', { by: 'ui', notifyAgent: true });
    expect(row.status).toBe('executed');
    expect((await getAgent(receiver.id))?.color).toBe('#0000ff');
    const jobs = await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, receiver.id));
    const wake = jobs.find((job) => job.type === 'agent.wake' && (job.payload as { teamResume?: { handoffId?: string } }).teamResume);
    const payload = wake?.payload as { depth: number; conversationId: string; teamResume: { depth: number; teamMessageId: string } };
    expect(payload.depth).toBe(4);
    expect(payload.teamResume.depth).toBe(4);
    expect(payload.teamResume.teamMessageId).toBe(tm.id);
    expect(payload.conversationId).toBe(delegation.pairConversationId);
    expect(jobs.some((job) => job.type === 'agent.wake' && (job.payload as { depth?: number; teamResume?: unknown }).depth === 0 && (job.payload as { teamResume?: unknown }).teamResume)).toBe(false);
  });

  it('renvoie le résultat au compagnon qui a délégué et à celui qui a agi, sans remettre le compteur à zéro', async () => {
    const { sender, receiver, tm, main } = await delegated(4, 'prépare le devis');
    const routed = await deliverTeamResult(tm, { messageId: 'm', text: 'Le devis est prêt.', silent: false, error: null });
    expect(routed).toMatchObject({ woke: true, depth: 5 });
    const wakes = await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, sender.id));
    const reply = wakes.find((job) => job.type === 'agent.wake' && (job.payload as { event?: { type?: string } }).event?.type === 'agent_reply');
    const payload = reply?.payload as { depth: number; conversationId?: string; text: string };
    expect(payload.depth).toBe(5);
    expect(payload.conversationId).toBe(main);
    expect(payload.text).toContain('Le devis est prêt.');
    const actor = await loadMessages(await mainConversationId(receiver.id));
    expect(actor.messages.some((m) => m.parts.some((p) => p.type === 'text' && p.text.includes('Le devis est prêt.')))).toBe(true);

    const capped = await delegated(6, 'encore un relais');
    const stopped = await deliverTeamResult(capped.tm, { messageId: 'm2', text: 'Résultat à la limite.', silent: false, error: null });
    expect(stopped).toMatchObject({ woke: false, depth: 6 });
    const senderNotes = await loadMessages(capped.main);
    expect(senderNotes.messages.some((m) => m.parts.some((p) => p.type === 'text' && p.text.includes('Résultat à la limite.')))).toBe(true);
    const reset = (await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, capped.sender.id))).filter((job) => job.type === 'agent.wake');
    expect(reset.some((job) => (job.payload as { depth?: number }).depth === 0)).toBe(false);
  });

  it('laisse une validation du fil principal réveiller à la profondeur 0', async () => {
    const agent = await createAgent({ name: 'SoloApproval' });
    const { createApproval } = await import('../src/approvals/service.ts');
    const ap = await createApproval({ agentId: agent.id, conversationId: await mainConversationId(agent.id), action: 'test.missing', summary: 'Action locale', input: {} });
    await resolveApproval(ap.id, 'reject', { by: 'ui', notifyAgent: true });
    const jobs = await db().select().from(schema.jobs).where(eq(schema.jobs.agentId, agent.id));
    const wake = jobs.find((job) => job.type === 'agent.wake');
    expect((wake?.payload as { depth: number; teamResume?: unknown }).depth).toBe(0);
    expect((wake?.payload as { teamResume?: unknown }).teamResume).toBeUndefined();
  });
});

describe('profil et outils de délégation', () => {
  it('exige une validation pour un autre compagnon, y compris sur une demande directe', async () => {
    const actor = (await getAgent((await createAgent({ name: 'RobinAsk' })).id))!;
    const other = await createAgent({ name: 'OtherDot' });
    const direct = buildTools({ agent: actor, conversationId: await mainConversationId(actor.id), isMain: true, userTurn: true, depth: 0, tz: 'UTC' });
    const self: any = await direct.agent_update_profile.execute!({ color: '#abcdef' } as any, { toolCallId: 'self', messages: [] } as any);
    expect(self.status).not.toBe('pending_approval');
    expect((await getAgent(actor.id))?.color).toBe('#abcdef');
    const asked: any = await direct.agent_update_profile.execute!({ agent: other.id, color: '#010101' } as any, { toolCallId: 'other', messages: [] } as any);
    expect(asked.status).toBe('pending_approval');
    expect((await getAgent(other.id))?.color).not.toBe('#010101');
    expect((await resolveApproval(asked.approvalId, 'approve', { by: 'ui', notifyAgent: false })).status).toBe('executed');
    expect((await getAgent(other.id))?.color).toBe('#010101');
  });

  it('refuse un tiers pendant un échange et revérifie le nom au moment de la validation', async () => {
    const { sender, receiver, delegation } = await delegated(2, 'renomme-toi');
    const tools = buildTools(toolCtx(receiver, delegation));
    const stranger = await createAgent({ name: 'StrangerDot' });
    const denied: any = await tools.agent_update_profile.execute!({ agent: stranger.id, color: '#222222' } as any, { toolCallId: 'deny', messages: [] } as any);
    expect(denied.ok).toBe(false);
    expect((await getAgent(stranger.id))?.color).not.toBe('#222222');
    const pending: any = await tools.agent_update_profile.execute!({ agent: sender.id, name: 'NomLibre' } as any, { toolCallId: 'name', messages: [] } as any);
    expect(pending.status).toBe('pending_approval');
    await createAgent({ name: 'NomLibre' });
    const failed = await resolveApproval(pending.approvalId, 'approve', { by: 'ui', notifyAgent: false });
    expect(failed.status).toBe('failed');
    expect((await getAgent(sender.id))?.name).toBe(sender.name);
  });

  it('expose le formulaire, le bureau et la connexion, avec leur carte dans le fil principal', async () => {
    const { sender, receiver, delegation } = await delegated(3, 'ouvre le navigateur et connecte Gmail');
    const { tools, info } = await buildCapabilityTools(toolCtx(receiver, delegation));
    expect(tools.ask_user).toBeDefined();
    expect(tools.computer_request_setup).toBeDefined();
    expect(tools.connection_request_setup).toBeDefined();
    expect(tools.skill_save).toBeUndefined();
    expect(info.connectors.join('\n')).toContain('Gmail');
    expect(info.connectors.join('\n')).toContain('ne signifie PAS connecté');
    const question: any = await tools.ask_user.execute!({ title: 'Quel délai ?', questions: [{ id: 'delai', label: 'Délai', type: 'text', required: true }] } as any, { toolCallId: 'q', messages: [] } as any);
    expect(question.status).toBe('awaiting_user');
    const desktop: any = await tools.computer_request_setup.execute!({ reason: 'Il faut un navigateur' } as any, { toolCallId: 'd', messages: [] } as any);
    expect(desktop.status).toBe('setup_requested');
    expect((await getAgent(receiver.id))?.permissions.computer).toBe(false);
    const connect: any = await tools.connection_request_setup.execute!({ kind: 'integration', provider: 'gmail', permissions: ['send'], reason: 'Envoyer le devis' } as any, { toolCallId: 'c', messages: [] } as any);
    expect(connect.status).toBe('setup_requested');
    const { messages } = await loadMessages(delegation.mainConversationId);
    const blob = JSON.stringify(messages);
    expect(blob).toContain(question.requestId);
    expect(blob).toContain('Quel délai ?');
    expect(blob).toContain('Il faut un navigateur');
    expect(blob).toContain('gmail');
    expect(blob).toContain(sender.name);
    expect(blob).toContain('ouvre le navigateur');
    const handoffs = await db().select().from(schema.teamHandoffs).where(eq(schema.teamHandoffs.agentId, receiver.id));
    expect(handoffs.find((h) => h.kind === 'question')?.depth).toBe(3);
    expect(handoffs.find((h) => h.kind === 'desktop')?.depth).toBe(3);
    expect(handoffs.find((h) => h.kind === 'connection')?.depth).toBe(3);
  });
});

describe('plafond des tours d’équipe', () => {
  it('utilise 12 étapes et 5 minutes tant que rien n’est configuré, puis la valeur choisie', async () => {
    expect(await getTeamTurnStepLimit()).toBe(DEFAULT_TEAM_TURN_STEPS);
    expect(await getTeamTurnTimeoutMs()).toBe(DEFAULT_TEAM_TURN_TIMEOUT_SEC * 1000);
    await setSetting('engine.teamTurnStepLimit', 7);
    await setSetting('engine.teamTurnTimeoutSec', 120);
    expect(await getTeamTurnStepLimit()).toBe(7);
    expect(await getTeamTurnTimeoutMs()).toBe(120_000);
    await setSetting('engine.teamTurnStepLimit', null);
    await setSetting('engine.teamTurnTimeoutSec', null);
  });
});
