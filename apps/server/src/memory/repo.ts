import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { MemoryDTO } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { newId } from '../util.ts';

type Row = typeof schema.memories.$inferSelect;

function toDTO(r: Row): MemoryDTO {
  return {
    id: r.id,
    agentId: r.agentId,
    content: r.content,
    kind: r.kind,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function remember(agentId: string | null, content: string, kind = 'fact', source = 'conversation') {
  const row = { id: newId('mem'), agentId, content: content.trim(), kind, source };
  await db().insert(schema.memories).values(row);
  publish({ type: 'memory.changed', agentId });
  return row.id;
}

export async function updateMemory(id: string, agentId: string, content: string) {
  const res = await db()
    .update(schema.memories)
    .set({ content: content.trim(), updatedAt: new Date() })
    .where(and(eq(schema.memories.id, id), or(eq(schema.memories.agentId, agentId), isNull(schema.memories.agentId))))
    .returning({ id: schema.memories.id });
  publish({ type: 'memory.changed', agentId });
  return res.length > 0;
}

export async function forget(id: string, agentId: string | null) {
  const cond = agentId
    ? and(eq(schema.memories.id, id), or(eq(schema.memories.agentId, agentId), isNull(schema.memories.agentId)))
    : eq(schema.memories.id, id);
  const res = await db().delete(schema.memories).where(cond).returning({ id: schema.memories.id });
  publish({ type: 'memory.changed', agentId });
  return res.length > 0;
}

export async function listMemories(agentId: string, opts: { includeShared?: boolean } = {}): Promise<MemoryDTO[]> {
  const cond = opts.includeShared
    ? or(eq(schema.memories.agentId, agentId), isNull(schema.memories.agentId))
    : eq(schema.memories.agentId, agentId);
  const rows = await db().select().from(schema.memories).where(cond).orderBy(desc(schema.memories.updatedAt));
  return rows.map(toDTO);
}

export async function listSharedMemories(): Promise<MemoryDTO[]> {
  const rows = await db().select().from(schema.memories).where(isNull(schema.memories.agentId)).orderBy(desc(schema.memories.updatedAt));
  return rows.map(toDTO);
}

/** Recherche plein texte (simple, multilingue) dans la mémoire d'un compagnon. */
export async function searchMemories(agentId: string, query: string, limit = 12): Promise<MemoryDTO[]> {
  const q = query.trim();
  if (!q) return [];
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .slice(0, 12);
  if (!words.length) return [];
  const tsQuery = words.map((w) => w.replace(/'/g, '')).join(' | ');
  const rows = await db()
    .select()
    .from(schema.memories)
    .where(
      and(
        or(eq(schema.memories.agentId, agentId), isNull(schema.memories.agentId)),
        or(
          sql`to_tsvector('simple', ${schema.memories.content}) @@ to_tsquery('simple', ${tsQuery})`,
          ...words.map((w) => sql`${schema.memories.content} ILIKE ${'%' + w + '%'}`),
        ),
      ),
    )
    .orderBy(
      desc(sql`ts_rank(to_tsvector('simple', ${schema.memories.content}), to_tsquery('simple', ${tsQuery}))`),
      desc(schema.memories.updatedAt),
    )
    .limit(limit);
  return rows.map(toDTO);
}

/**
 * Sélection contextuelle : mémoires récentes + mémoires pertinentes pour le
 * message courant, sans injecter toute la mémoire à chaque tour.
 */
export async function contextMemories(agentId: string, hint: string, budget = 40): Promise<MemoryDTO[]> {
  const all = await listMemories(agentId, { includeShared: true });
  if (all.length <= budget) return all;
  const relevant = await searchMemories(agentId, hint, Math.floor(budget / 2));
  const ids = new Set(relevant.map((m) => m.id));
  const recent = all.filter((m) => !ids.has(m.id)).slice(0, budget - relevant.length);
  return [...relevant, ...recent];
}

export async function deleteMemoriesOf(ids: string[]) {
  if (!ids.length) return;
  await db().delete(schema.memories).where(inArray(schema.memories.id, ids));
}
