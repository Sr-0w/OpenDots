import { asc, eq, sql } from 'drizzle-orm';
import type { SkillDTO } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { newId } from '../util.ts';

/**
 * Skills : prompts réutilisables partagés par tous les compagnons. Seuls leur
 * nom et leur description sont injectés dans le contexte ; les instructions
 * complètes sont chargées à la demande (skill_use).
 */
type Row = typeof schema.skills.$inferSelect;

export class SkillError extends Error {}

export function toSkillDTO(r: Row): SkillDTO {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    enabled: r.enabled,
    pluginId: r.pluginId,
    createdBy: r.createdBy,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function normalizeName(name: string) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 60) throw new SkillError('Le nom d’un skill doit faire entre 1 et 60 caractères.');
  return clean;
}

export async function listSkills(opts: { enabledOnly?: boolean } = {}): Promise<Row[]> {
  return db()
    .select()
    .from(schema.skills)
    .where(opts.enabledOnly ? eq(schema.skills.enabled, true) : undefined)
    .orderBy(asc(schema.skills.name));
}

export async function getSkill(id: string): Promise<Row | null> {
  const [row] = await db().select().from(schema.skills).where(eq(schema.skills.id, id));
  return row ?? null;
}

export async function findSkill(ref: string): Promise<Row | null> {
  const byId = await getSkill(ref);
  if (byId) return byId;
  const [row] = await db().select().from(schema.skills).where(sql`lower(${schema.skills.name}) = lower(${ref.trim()})`);
  return row ?? null;
}

export async function createSkill(input: {
  name: string;
  description: string;
  instructions: string;
  createdBy?: string;
  pluginId?: string | null;
}): Promise<Row> {
  const name = normalizeName(input.name);
  if (await findSkill(name)) throw new SkillError(`Un skill « ${name} » existe déjà.`);
  if (!input.instructions.trim()) throw new SkillError('Les instructions du skill sont vides.');
  const row = {
    id: newId('sk'),
    name,
    description: input.description.trim().slice(0, 500),
    instructions: input.instructions.trim(),
    createdBy: input.createdBy ?? 'user',
    pluginId: input.pluginId ?? null,
  };
  await db().insert(schema.skills).values(row);
  publish({ type: 'skills.changed' });
  return (await getSkill(row.id))!;
}

export async function updateSkill(
  id: string,
  patch: Partial<Pick<Row, 'name' | 'description' | 'instructions' | 'enabled'>>,
): Promise<Row> {
  const current = await getSkill(id);
  if (!current) throw new SkillError('Skill introuvable.');
  const next = { ...patch, updatedAt: new Date() };
  if (patch.name !== undefined) {
    next.name = normalizeName(patch.name);
    const other = await findSkill(next.name);
    if (other && other.id !== id) throw new SkillError(`Un skill « ${next.name} » existe déjà.`);
  }
  await db().update(schema.skills).set(next).where(eq(schema.skills.id, id));
  publish({ type: 'skills.changed' });
  return (await getSkill(id))!;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const res = await db().delete(schema.skills).where(eq(schema.skills.id, id)).returning({ id: schema.skills.id });
  publish({ type: 'skills.changed' });
  return res.length > 0;
}
