import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, openDatabase, schema } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { buildTools } from '../src/agents/tools.ts';
import { loadMessages, pairConversationId } from '../src/conversations/repo.ts';
import { sendTeamMessage, TeamError } from '../src/team/service.ts';
import { decideReply, isPureAck, PAIR_THREAD_CAP, shouldWakeSender } from '../src/team/policy.ts';

beforeAll(async () => {
  await openDatabase({ memory: true });
});
afterAll(async () => {
  await closeDatabase();
});

describe('politique de messagerie entre compagnons', () => {
  it('reconnaît les simples accusés de réception', () => {
    for (const t of ['Merci !', 'ok', 'Super, bien reçu.', 'Thanks', '👍', 'Parfait, merci']) expect(isPureAck(t)).toBe(true);
    for (const t of ['Merci, et tu peux vérifier le prix ?', 'Ok, voici le rapport : 3 offres trouvées à Liège', 'Peux-tu regarder ?'])
      expect(isPureAck(t)).toBe(false);
  });

  it('interprète la réponse finale', () => {
    expect(decideReply('<no_reply/>')).toEqual({ kind: 'no_reply' });
    expect(decideReply('  ')).toEqual({ kind: 'missing' });
    expect(decideReply('Voici')).toEqual({ kind: 'reply', text: 'Voici' });
  });

  it("ne réveille l'expéditeur que pour une vraie réponse, sous les limites", () => {
    const base = { expectsReply: true, decision: decideReply('Résultat'), depth: 1, maxDepth: 6, threadCount: 1 };
    expect(shouldWakeSender(base)).toBe(true);
    expect(shouldWakeSender({ ...base, expectsReply: false })).toBe(false);
    expect(shouldWakeSender({ ...base, decision: decideReply('<no_reply/>') })).toBe(false);
    expect(shouldWakeSender({ ...base, depth: 6 })).toBe(false);
    expect(shouldWakeSender({ ...base, threadCount: PAIR_THREAD_CAP })).toBe(false);
  });
});

describe('service de messagerie', () => {
  it("un remerciement n'attend jamais de réponse", async () => {
    const a = await createAgent({ name: 'Ack1' });
    const b = await createAgent({ name: 'Ack2' });
    const tm = await sendTeamMessage({ fromAgentId: a.id, toAgentId: b.id, content: 'Merci !', expectsReply: true, replyToConversationId: null, depth: 1 });
    expect(tm.expectsReply).toBe(false);
  });

  it("signale dans le fil principal un envoi fait depuis un fil entre compagnons", async () => {
    const a = await createAgent({ name: 'Note1' });
    const b = await createAgent({ name: 'Note2' });
    await sendTeamMessage({ fromAgentId: a.id, toAgentId: b.id, content: 'Peux-tu vérifier X ?', expectsReply: true, replyToConversationId: null, depth: 1 });
    const { messages } = await loadMessages(await mainConversationId(a.id), { limit: 10 });
    expect(messages.some((m) => m.metadata?.event?.title === 'Message envoyé à Note2')).toBe(true);
  });

  it('limite le nombre de messages dans un fil (anti ping-pong)', async () => {
    const a = await createAgent({ name: 'Loop1' });
    const b = await createAgent({ name: 'Loop2' });
    const main = await mainConversationId(a.id);
    for (let i = 0; i < PAIR_THREAD_CAP; i++)
      await sendTeamMessage({ fromAgentId: i % 2 ? b.id : a.id, toAgentId: i % 2 ? a.id : b.id, content: `Question ${i} ?`, expectsReply: true, replyToConversationId: main, depth: 1 });
    await expect(
      sendTeamMessage({ fromAgentId: a.id, toAgentId: b.id, content: 'Encore ?', expectsReply: true, replyToConversationId: main, depth: 1 }),
    ).rejects.toBeInstanceOf(TeamError);
    const conv = await pairConversationId(a.id, b.id);
    const rows = await db().select().from(schema.teamMessages).where(eq(schema.teamMessages.conversationId, conv));
    expect(rows.length).toBe(PAIR_THREAD_CAP);
  });

  it("refuse team_send_message pour répondre au coéquipier qui écrit", async () => {
    const a = (await getAgent((await createAgent({ name: 'Peer1' })).id))!;
    const b = await createAgent({ name: 'Peer2' });
    const conv = await pairConversationId(a.id, b.id);
    const tools = buildTools({ agent: a, conversationId: conv, isMain: false, userTurn: false, depth: 1, tz: 'UTC', peerAgentId: b.id });
    expect(tools.team_send_message).toBeDefined();
    const out: any = await tools.team_send_message.execute!({ to: 'Peer2', message: 'Voici ma réponse' } as any, { toolCallId: 't', messages: [] } as any);
    expect(out.ok).toBe(false);
    expect(String(out.error)).toMatch(/automatiquement/);
  });
});
