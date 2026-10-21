import { asc, eq } from 'drizzle-orm';
import type { ConnectorDTO, ConnectorKind } from '@opendots/shared';
import { db, schema } from '../db/client.ts';
import { publish } from '../bus.ts';
import { decryptSecret, encryptSecret } from '../secrets.ts';
import { newId } from '../util.ts';

export type ConnectorRow = typeof schema.connectors.$inferSelect;

export class ConnectorError extends Error {}

export function readSecrets(row: Pick<ConnectorRow, 'secret'>): Record<string, string> {
  if (!row.secret) return {};
  try {
    return JSON.parse(decryptSecret(row.secret));
  } catch {
    return {};
  }
}

export function toConnectorDTO(r: ConnectorRow): ConnectorDTO {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    config: r.config as ConnectorDTO['config'],
    secretKeys: Object.keys(readSecrets(r)),
    enabled: r.enabled,
    approval: r.approval,
    status: r.status,
    lastError: r.lastError,
    tools: r.tools ?? [],
    pluginId: r.pluginId,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listConnectors(kind?: ConnectorKind): Promise<ConnectorRow[]> {
  return db()
    .select()
    .from(schema.connectors)
    .where(kind ? eq(schema.connectors.kind, kind) : undefined)
    .orderBy(asc(schema.connectors.createdAt));
}

export async function getConnector(id: string): Promise<ConnectorRow | null> {
  const [row] = await db().select().from(schema.connectors).where(eq(schema.connectors.id, id));
  return row ?? null;
}

export async function createConnector(input: {
  name: string;
  kind: ConnectorKind;
  config: Record<string, any>;
  secrets?: Record<string, string>;
  approval?: 'ask' | 'auto';
  pluginId?: string | null;
}): Promise<ConnectorRow> {
  const row = {
    id: newId(input.kind === 'mail' ? 'mail' : 'mcp'),
    name: input.name.trim().slice(0, 80) || 'Connecteur',
    kind: input.kind,
    config: input.config,
    secret: input.secrets && Object.keys(input.secrets).length ? encryptSecret(JSON.stringify(input.secrets)) : null,
    approval: input.approval ?? 'ask',
    pluginId: input.pluginId ?? null,
  };
  await db().insert(schema.connectors).values(row);
  publish({ type: 'connectors.changed' });
  return (await getConnector(row.id))!;
}

export async function updateConnector(
  id: string,
  patch: Partial<Pick<ConnectorRow, 'name' | 'config' | 'enabled' | 'approval' | 'status' | 'lastError' | 'tools' | 'state'>> & {
    secrets?: Record<string, string>;
  },
): Promise<ConnectorRow> {
  const current = await getConnector(id);
  if (!current) throw new ConnectorError('Connecteur introuvable.');
  const { secrets, ...rest } = patch;
  const next: Partial<ConnectorRow> = { ...rest, updatedAt: new Date() };
  if (secrets) {
    // Les valeurs vides conservent le secret existant.
    const merged = { ...readSecrets(current) };
    for (const [k, v] of Object.entries(secrets)) if (v) merged[k] = v;
    next.secret = Object.keys(merged).length ? encryptSecret(JSON.stringify(merged)) : null;
  }
  await db().update(schema.connectors).set(next).where(eq(schema.connectors.id, id));
  publish({ type: 'connectors.changed' });
  return (await getConnector(id))!;
}

export async function deleteConnector(id: string): Promise<boolean> {
  const res = await db().delete(schema.connectors).where(eq(schema.connectors.id, id)).returning({ id: schema.connectors.id });
  publish({ type: 'connectors.changed' });
  return res.length > 0;
}

/** Identifiant court utilisable dans un nom d'outil. */
export function connectorSlug(row: Pick<ConnectorRow, 'name' | 'id'>): string {
  const base = row.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 16);
  return base || row.id.slice(-6);
}
