import { and, desc, eq } from 'drizzle-orm';
import type { UIMessageChunk } from 'ai';
import { db, schema } from '../db/client.ts';
import { enqueue } from '../jobs/queue.ts';
import { saveMessage } from '../conversations/repo.ts';
import { postTeamNote, updateTeamMessage, type TeamMessageRow } from './service.ts';
import { getAgent } from '../agents/repo.ts';
import { ActiveStream } from '../agents/streams.ts';
import { newId } from '../util.ts';

/** Contexte d'une délégation en cours, transmis aux outils du tour d'équipe. */
export interface TeamDelegation {
  teamMessageId: string;
  fromAgentId: string;
  fromName: string;
  task: string;
  depth: number;
  expectsReply: boolean;
  pairConversationId: string;
  mainConversationId: string;
}

export type HandoffKind = 'approval' | 'question' | 'desktop' | 'connection';

/** Réveil qui reprend le fil d'équipe sans remettre la profondeur à zéro. */
export interface TeamResumeWake {
  handoffId: string;
  teamMessageId: string;
  fromAgentId: string;
  expectsReply: boolean;
  depth: number;
}

export type HandoffRow = typeof schema.teamHandoffs.$inferSelect;

export function withDelegationSummary(delegation: TeamDelegation | null | undefined, summary: string): string {
  if (!delegation) return summary;
  const task = delegation.task.replace(/\s+/g, ' ').trim().slice(0, 90);
  return task ? `${delegation.fromName} · « ${task} » — ${summary}` : `${delegation.fromName} — ${summary}`;
}

function contextLine(agentName: string, delegation: TeamDelegation, detail: string): string {
  const task = delegation.task.replace(/\s+/g, ' ').trim().slice(0, 280);
  return `${delegation.fromName} a demandé à ${agentName} : « ${task} ». ${detail}`;
}

/** Carte visible dans le fil principal du compagnon qui agit, là où Robin lit. */
export async function mirrorUserCard(input: {
  agentId: string;
  mainConversationId: string;
  text: string;
  tool: string;
  toolInput?: unknown;
  output: Record<string, unknown>;
}) {
  await saveMessage(
    input.mainConversationId,
    {
      id: newId('msg'),
      role: 'assistant',
      parts: [
        { type: 'text', text: input.text },
        {
          type: `tool-${input.tool}`,
          toolCallId: newId('call'),
          state: 'output-available',
          input: input.toolInput ?? {},
          output: input.output,
        },
      ] as never,
      metadata: { kind: 'chat', agentId: input.agentId, createdAt: new Date().toISOString() },
    },
    { author: 'agent', agentId: input.agentId },
  );
}

export async function openHandoff(input: {
  agentId: string;
  kind: HandoffKind;
  refId?: string | null;
  delegation: TeamDelegation;
}): Promise<HandoffRow> {
  if (!input.refId) {
    await db()
      .update(schema.teamHandoffs)
      .set({ status: 'cancelled' })
      .where(and(eq(schema.teamHandoffs.agentId, input.agentId), eq(schema.teamHandoffs.kind, input.kind), eq(schema.teamHandoffs.status, 'pending')));
  }
  const id = newId('th');
  await db().insert(schema.teamHandoffs).values({
    id,
    agentId: input.agentId,
    kind: input.kind,
    refId: input.refId ?? null,
    pairConversationId: input.delegation.pairConversationId,
    mainConversationId: input.delegation.mainConversationId,
    teamMessageId: input.delegation.teamMessageId,
    fromAgentId: input.delegation.fromAgentId,
    task: input.delegation.task.slice(0, 500),
    depth: input.delegation.depth,
    expectsReply: input.delegation.expectsReply,
  });
  const [row] = await db().select().from(schema.teamHandoffs).where(eq(schema.teamHandoffs.id, id));
  return row!;
}

/** Enregistre la validation et copie sa carte dans le fil principal. */
export async function trackApproval(
  ctx: { agent: { id: string; name: string }; delegation?: TeamDelegation | null },
  approval: { id: string; summary: string },
  card: { tool: string; input?: unknown; output?: Record<string, unknown> },
) {
  if (!ctx.delegation) return;
  await openHandoff({ agentId: ctx.agent.id, kind: 'approval', refId: approval.id, delegation: ctx.delegation });
  await mirrorUserCard({
    agentId: ctx.agent.id,
    mainConversationId: ctx.delegation.mainConversationId,
    text: contextLine(ctx.agent.name, ctx.delegation, `Cette action attend ta validation : ${approval.summary}`),
    tool: card.tool,
    toolInput: card.input,
    output: { ok: true, status: 'pending_approval', approvalId: approval.id, summary: approval.summary, ...(card.output ?? {}) },
  });
}

/** Formulaire, bureau ou connexion : la carte est dans le fil principal, la reprise garde la profondeur. */
export async function trackUserCard(
  ctx: { agent: { id: string; name: string }; delegation?: TeamDelegation | null },
  card: { kind: 'question' | 'desktop' | 'connection'; refId?: string | null; detail: string; tool: string; input?: unknown; output: Record<string, unknown> },
) {
  if (!ctx.delegation) return;
  await openHandoff({ agentId: ctx.agent.id, kind: card.kind, refId: card.refId, delegation: ctx.delegation });
  await mirrorUserCard({
    agentId: ctx.agent.id,
    mainConversationId: ctx.delegation.mainConversationId,
    text: contextLine(ctx.agent.name, ctx.delegation, card.detail),
    tool: card.tool,
    toolInput: card.input,
    output: card.output,
  });
}

async function claim(where: ReturnType<typeof and>): Promise<HandoffRow | null> {
  const [row] = await db().select().from(schema.teamHandoffs).where(where).orderBy(desc(schema.teamHandoffs.createdAt)).limit(1);
  if (!row) return null;
  const claimed = await db()
    .update(schema.teamHandoffs)
    .set({ status: 'resumed' })
    .where(and(eq(schema.teamHandoffs.id, row.id), eq(schema.teamHandoffs.status, 'pending')))
    .returning();
  return claimed[0] ?? null;
}

export function takeHandoff(kind: HandoffKind, refId: string) {
  return claim(and(eq(schema.teamHandoffs.kind, kind), eq(schema.teamHandoffs.refId, refId), eq(schema.teamHandoffs.status, 'pending')));
}

export function takeLatestHandoff(agentId: string, kind: HandoffKind) {
  return claim(and(eq(schema.teamHandoffs.agentId, agentId), eq(schema.teamHandoffs.kind, kind), eq(schema.teamHandoffs.status, 'pending')));
}

export async function resumeHandoff(row: HandoffRow, text: string) {
  const from = await getAgent(row.fromAgentId);
  const name = from?.name ?? 'ton coéquipier';
  await enqueue(
    'agent.wake',
    {
      agentId: row.agentId,
      conversationId: row.pairConversationId,
      event: {
        type: row.kind === 'approval' ? 'approval' : 'system',
        title: `Suite demandée par ${name}`,
        approvalId: row.kind === 'approval' ? row.refId ?? undefined : undefined,
        fromAgentId: row.fromAgentId,
      },
      text:
        `${text}\n\nTu reprends la tâche que ${name} t'a déléguée : « ${row.task.slice(0, 500)} ».\n` +
        `Termine le travail, puis réponds à ${name}. Ta réponse finale lui est transmise, ainsi qu'une note dans ton fil principal. ` +
        `Cette collaboration reste à la profondeur ${row.depth} : n'ouvre pas une nouvelle chaîne.`,
      depth: row.depth,
      teamResume: {
        handoffId: row.id,
        teamMessageId: row.teamMessageId,
        fromAgentId: row.fromAgentId,
        expectsReply: row.expectsReply,
        depth: row.depth,
      } satisfies TeamResumeWake,
    },
    { agentId: row.agentId, dedupeKey: `handoff:${row.id}` },
  );
}

/**
 * Tant qu'une carte attend l'utilisateur, on ne réveille pas le compagnon qui a délégué.
 * Le résultat réel part après la décision, à la profondeur d'origine.
 */
export async function holdForUser(tm: TeamMessageRow, interim: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.teamHandoffs.id })
    .from(schema.teamHandoffs)
    .where(and(eq(schema.teamHandoffs.teamMessageId, tm.id), eq(schema.teamHandoffs.status, 'pending')))
    .limit(1);
  if (!row) return false;
  const actor = await getAgent(tm.toAgentId);
  await updateTeamMessage(tm.id, { status: 'answered', reply: interim || null, answeredAt: new Date() });
  await postTeamNote(tm.toAgentId, tm.fromAgentId, 'agent_message', 'En attente de validation avant de répondre à', interim || 'Une carte attend l’utilisateur dans ce fil.', `msg_wait_${tm.id}`);
  await postTeamNote(
    tm.fromAgentId,
    tm.toAgentId,
    'agent_reply',
    'Attend une validation de',
    `${actor?.name ?? 'Un compagnon'} a préparé une action qui attend l’utilisateur. Le résultat arrivera ensuite.${interim ? `\n\n${interim}` : ''}`,
    `msg_wait_from_${tm.id}`,
  );
  return true;
}

/** Reprend une délégation en attente (bureau ou connexion). Renvoie false s'il n'y en a pas. */
export async function resumePendingHandoff(agentId: string, kind: 'desktop' | 'connection', text: string): Promise<boolean> {
  const row = await takeLatestHandoff(agentId, kind);
  if (!row) return false;
  await resumeHandoff(row, text);
  return true;
}

/** Flux court pour que le chat affiche la note pendant que le fil d'équipe reprend le travail. */
export function finishedTextStream(conversationId: string, messageId: string, text: string): ReadableStream<UIMessageChunk> {
  const stream = new ActiveStream(conversationId);
  const id = 'note';
  stream.push({ type: 'start', messageId });
  stream.push({ type: 'text-start', id });
  stream.push({ type: 'text-delta', id, delta: text });
  stream.push({ type: 'text-end', id });
  stream.push({ type: 'finish', finishReason: 'stop' });
  stream.end();
  return stream.readable();
}
