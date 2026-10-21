import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { JournalEntryDTO } from '@opendots/shared';
import { db, schema } from './db/client.ts';
import { publish } from './bus.ts';
import { newId } from './util.ts';

/** Journal d'exécution : trace des opérations importantes (16.5). */
export async function log(agentId: string | null, kind: string, summary: string, data?: unknown) {
  const row = { id: newId('jr'), agentId, kind, summary, data: (data ?? null) as any, createdAt: new Date() };
  await db().insert(schema.journal).values(row);
  publish({ type: 'journal.created', entry: toDTO(row) });
}

function toDTO(r: typeof schema.journal.$inferSelect): JournalEntryDTO {
  return { id: r.id, agentId: r.agentId, kind: r.kind, summary: r.summary, data: r.data, createdAt: r.createdAt.toISOString() };
}

export async function listJournal(agentId?: string, limit = 100): Promise<JournalEntryDTO[]> {
  const where = agentId ? or(eq(schema.journal.agentId, agentId), isNull(schema.journal.agentId)) : undefined;
  const rows = await db()
    .select()
    .from(schema.journal)
    .where(where ? and(where) : undefined)
    .orderBy(desc(schema.journal.createdAt))
    .limit(limit);
  return rows.map(toDTO);
}
