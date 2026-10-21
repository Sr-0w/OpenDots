import { and, desc, eq } from 'drizzle-orm';
import type { ApprovalDTO, ApprovalStatus } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { log } from '../journal.ts';
import { enqueue } from '../jobs/queue.ts';
import { errorMessage, newId } from '../util.ts';

/**
 * Moteur d'approbation : une opération sensible est enregistrée « préparée »,
 * puis exécutée par le backend uniquement après validation humaine. Le
 * résultat réel (exécutée / échouée) est conservé et renvoyé au compagnon.
 */
type Row = typeof schema.approvals.$inferSelect;
type Executor = (input: any, approval: Row) => Promise<unknown>;

const executors = new Map<string, Executor>();

export function registerApprovalAction(action: string, executor: Executor) {
  executors.set(action, executor);
}

export function toApprovalDTO(r: Row): ApprovalDTO {
  return {
    id: r.id,
    agentId: r.agentId,
    conversationId: r.conversationId,
    action: r.action,
    summary: r.summary,
    input: r.input,
    status: r.status,
    result: r.result,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}

export async function createApproval(input: {
  agentId: string;
  conversationId: string;
  toolCallId?: string;
  action: string;
  summary: string;
  input: unknown;
}): Promise<Row> {
  const row = {
    id: newId('ap'),
    agentId: input.agentId,
    conversationId: input.conversationId,
    toolCallId: input.toolCallId ?? null,
    action: input.action,
    summary: input.summary,
    input: input.input as object,
  };
  await db().insert(schema.approvals).values(row);
  const created = (await getApproval(row.id))!;
  publish({ type: 'approval.changed', approval: toApprovalDTO(created) });
  await log(input.agentId, 'approval.requested', `Validation demandée : ${input.summary}`, { approvalId: row.id });
  return created;
}

export async function getApproval(id: string): Promise<Row | null> {
  const [row] = await db().select().from(schema.approvals).where(eq(schema.approvals.id, id));
  return row ?? null;
}

export async function listApprovals(filter: { agentId?: string; status?: ApprovalStatus } = {}): Promise<ApprovalDTO[]> {
  const conds = [];
  if (filter.agentId) conds.push(eq(schema.approvals.agentId, filter.agentId));
  if (filter.status) conds.push(eq(schema.approvals.status, filter.status));
  const rows = await db()
    .select()
    .from(schema.approvals)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.approvals.createdAt))
    .limit(200);
  return rows.map(toApprovalDTO);
}

async function setStatus(id: string, patch: Partial<Row>): Promise<Row> {
  await db().update(schema.approvals).set(patch).where(eq(schema.approvals.id, id));
  const row = (await getApproval(id))!;
  publish({ type: 'approval.changed', approval: toApprovalDTO(row) });
  return row;
}

export class ApprovalError extends Error {}

/**
 * Applique une décision. `notifyAgent` réveille le compagnon pour qu'il
 * rapporte le résultat (inutile si la décision vient de sa propre conversation).
 */
export async function resolveApproval(
  id: string,
  decision: 'approve' | 'reject',
  opts: { by: 'ui' | 'conversation'; notifyAgent: boolean },
): Promise<Row> {
  // Transition atomique pending → approved/rejected : une seule exécution possible.
  const claimed = await db()
    .update(schema.approvals)
    .set({ status: decision === 'approve' ? 'approved' : 'rejected', resolvedAt: new Date(), resolvedBy: opts.by })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, 'pending')))
    .returning();
  if (!claimed.length) {
    const existing = await getApproval(id);
    if (!existing) throw new ApprovalError('Demande de validation introuvable.');
    throw new ApprovalError(`Cette demande a déjà été traitée (statut : ${existing.status}).`);
  }
  let row = claimed[0];
  publish({ type: 'approval.changed', approval: toApprovalDTO(row) });

  if (decision === 'reject') {
    await log(row.agentId, 'approval.rejected', `Refusé : ${row.summary}`, { approvalId: id });
  } else {
    const executor = executors.get(row.action);
    try {
      if (!executor) throw new Error(`Action inconnue : ${row.action}`);
      const result = await executor(row.input, row);
      row = await setStatus(id, { status: 'executed', result: (result ?? null) as any });
      await log(row.agentId, 'approval.executed', `Exécuté : ${row.summary}`, { approvalId: id, result });
    } catch (err) {
      row = await setStatus(id, { status: 'failed', error: errorMessage(err) });
      await log(row.agentId, 'approval.failed', `Échec : ${row.summary}`, { approvalId: id, error: errorMessage(err) });
    }
  }

  if (opts.notifyAgent) {
    const outcome =
      row.status === 'executed'
        ? `L'utilisateur a approuvé et l'action a été exécutée avec succès. Résultat : ${JSON.stringify(row.result)}`
        : row.status === 'failed'
          ? `L'utilisateur a approuvé mais l'exécution a échoué : ${row.error}`
          : `L'utilisateur a refusé cette action. Ne la réessaie pas sans nouvelle demande.`;
    await enqueue(
      'agent.wake',
      {
        agentId: row.agentId,
        conversationId: row.conversationId,
        event: { type: 'approval', title: `Validation : ${row.summary}`, approvalId: row.id },
        text: `${outcome}\nInforme brièvement l'utilisateur du résultat réel.`,
        depth: 0,
      },
      { agentId: row.agentId, dedupeKey: `approval:${row.id}` },
    );
  }
  return row;
}
