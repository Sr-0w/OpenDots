import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PluginDTO, PluginManifest } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { createSkill, findSkill } from '../skills/repo.ts';
import { createConnector } from './repo.ts';
import { closeMcpClient, refreshMcpConnector } from './mcp.ts';
import { log } from '../journal.ts';
import { newId } from '../util.ts';

/**
 * Plugins : paquets regroupant des skills et des connecteurs MCP, installés
 * depuis un manifeste JSON (collé ou téléchargé). L'installation est toujours
 * une action de l'utilisateur depuis l'interface.
 */
const manifestSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(1000).optional(),
  version: z.string().max(40).optional(),
  skills: z
    .array(z.object({ name: z.string().min(1).max(60), description: z.string().max(500), instructions: z.string().min(1).max(50_000) }))
    .max(50)
    .optional(),
  connectors: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        config: z.object({
          transport: z.enum(['http', 'sse', 'stdio']),
          url: z.string().url().optional(),
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
        }),
        approval: z.enum(['ask', 'auto']).optional(),
        secrets: z.array(z.string()).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export class PluginError extends Error {}

export function parseManifest(raw: unknown): PluginManifest {
  const res = manifestSchema.safeParse(raw);
  if (!res.success) throw new PluginError(`Manifeste invalide : ${res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`);
  return res.data;
}

export async function fetchManifest(url: string): Promise<PluginManifest> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new PluginError(`Téléchargement impossible (${res.status})`);
  return parseManifest(await res.json());
}

export async function listPlugins(): Promise<PluginDTO[]> {
  const rows = await db().select().from(schema.plugins).orderBy(asc(schema.plugins.installedAt));
  return rows.map((r) => {
    const m = r.manifest as PluginManifest;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      version: r.version,
      skills: m.skills?.length ?? 0,
      connectors: m.connectors?.length ?? 0,
      installedAt: r.installedAt.toISOString(),
    };
  });
}

export async function installPlugin(manifest: PluginManifest, opts: { source: string; secrets?: Record<string, Record<string, string>> }) {
  for (const s of manifest.skills ?? []) {
    if (await findSkill(s.name)) throw new PluginError(`Un skill « ${s.name} » existe déjà.`);
  }
  const id = newId('plg');
  await db()
    .insert(schema.plugins)
    .values({
      id,
      name: manifest.name,
      description: manifest.description ?? '',
      version: manifest.version ?? '0.0.0',
      manifest: manifest as object,
      source: opts.source,
    });
  for (const s of manifest.skills ?? []) await createSkill({ ...s, pluginId: id, createdBy: 'plugin' });
  const connectorIds: string[] = [];
  for (const c of manifest.connectors ?? []) {
    const row = await createConnector({
      name: c.name,
      kind: 'mcp',
      config: c.config,
      approval: c.approval ?? 'ask',
      secrets: opts.secrets?.[c.name],
      pluginId: id,
    });
    connectorIds.push(row.id);
  }
  // La connexion aux serveurs se fait en arrière-plan.
  for (const cid of connectorIds) void refreshMcpConnector(cid).catch(() => {});
  await log(null, 'plugin.installed', `Plugin installé : ${manifest.name}`, { pluginId: id });
  publish({ type: 'skills.changed' });
  publish({ type: 'connectors.changed' });
  return id;
}

export async function uninstallPlugin(id: string) {
  const [plugin] = await db().select().from(schema.plugins).where(eq(schema.plugins.id, id));
  if (!plugin) throw new PluginError('Plugin introuvable.');
  const connectors = await db().select({ id: schema.connectors.id }).from(schema.connectors).where(eq(schema.connectors.pluginId, id));
  for (const c of connectors) await closeMcpClient(c.id);
  await db().delete(schema.connectors).where(eq(schema.connectors.pluginId, id));
  await db().delete(schema.skills).where(eq(schema.skills.pluginId, id));
  await db().delete(schema.plugins).where(eq(schema.plugins.id, id));
  await log(null, 'plugin.uninstalled', `Plugin désinstallé : ${plugin.name}`);
  publish({ type: 'skills.changed' });
  publish({ type: 'connectors.changed' });
}
