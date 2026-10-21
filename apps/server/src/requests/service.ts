import { and, eq } from 'drizzle-orm';
import type { AskQuestion, UserRequestDTO } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { newId } from '../util.ts';

/** Demandes structurées (informations, choix) adressées par un compagnon à l'utilisateur. */
type Row = typeof schema.userRequests.$inferSelect;

export class RequestError extends Error {}

export function toRequestDTO(r: Row): UserRequestDTO {
  return {
    id: r.id,
    agentId: r.agentId,
    conversationId: r.conversationId,
    title: r.title,
    questions: r.questions,
    status: r.status,
    answers: r.answers ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function createRequest(input: { agentId: string; conversationId: string; title: string; questions: AskQuestion[] }) {
  const ids = new Set<string>();
  for (const q of input.questions) {
    if (ids.has(q.id)) throw new RequestError(`Identifiant de question dupliqué : ${q.id}`);
    ids.add(q.id);
    if ((q.type === 'single_choice' || q.type === 'multi_choice') && !(q.options?.length)) {
      throw new RequestError(`La question « ${q.label} » nécessite des options.`);
    }
  }
  // Une seule demande en attente par conversation : la précédente est annulée.
  await db()
    .update(schema.userRequests)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.userRequests.conversationId, input.conversationId), eq(schema.userRequests.status, 'pending')));
  const row = { id: newId('rq'), ...input };
  await db().insert(schema.userRequests).values(row);
  const created = (await getRequest(row.id))!;
  publish({ type: 'request.changed', request: toRequestDTO(created) });
  return created;
}

export async function getRequest(id: string): Promise<Row | null> {
  const [row] = await db().select().from(schema.userRequests).where(eq(schema.userRequests.id, id));
  return row ?? null;
}

/** Valide et enregistre les réponses. Renvoie un résumé lisible pour la conversation. */
export async function answerRequest(id: string, answers: Record<string, unknown>): Promise<{ row: Row; summary: string }> {
  const req = await getRequest(id);
  if (!req) throw new RequestError('Demande introuvable.');
  if (req.status !== 'pending') throw new RequestError('Cette demande a déjà reçu une réponse.');
  const clean: Record<string, unknown> = {};
  const lines: string[] = [];
  for (const q of req.questions) {
    let v = answers[q.id];
    if (q.type === 'multi_choice') v = Array.isArray(v) ? v.map(String) : [];
    else if (q.type === 'confirm') v = v === true || v === 'true' || v === 'oui';
    else if (q.type === 'number') v = v === '' || v === undefined || v === null ? null : Number(v);
    else v = v === undefined || v === null ? '' : String(v).slice(0, 5000);
    const empty = v === '' || v === null || (Array.isArray(v) && !v.length);
    if (q.required && empty && q.type !== 'confirm') throw new RequestError(`Réponse requise : ${q.label}`);
    clean[q.id] = v;
    const shown = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v ?? '');
    lines.push(`- ${q.label} : ${shown || '(sans réponse)'}`);
  }
  await db()
    .update(schema.userRequests)
    .set({ status: 'answered', answers: clean, answeredAt: new Date() })
    .where(eq(schema.userRequests.id, id));
  const row = (await getRequest(id))!;
  publish({ type: 'request.changed', request: toRequestDTO(row) });
  return { row, summary: `${req.title}\n${lines.join('\n')}` };
}
