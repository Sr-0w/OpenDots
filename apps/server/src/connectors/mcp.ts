import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { tool, type ToolSet } from 'ai';
import type { McpConfig } from '@opendots/shared';
import { connectorSlug, getConnector, listConnectors, readSecrets, updateConnector, type ConnectorRow } from './repo.ts';
import { errorMessage, truncate } from '../util.ts';
import { accountKey, currentAccount } from '../auth/context.ts';

/**
 * Gestionnaire des connecteurs MCP : une connexion paresseuse et mise en cache
 * par serveur. Un serveur en panne n'empêche jamais un compagnon de répondre.
 */
type Client = Awaited<ReturnType<typeof createMCPClient>>;

interface Entry {
  client: Client;
  updatedAt: Date;
}

const clients = new Map<string, Entry>();
const connecting = new Map<string, Promise<Client>>();

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} : délai dépassé`)), ms))]);
}

async function connect(row: ConnectorRow): Promise<Client> {
  const cfg = row.config as McpConfig;
  const secrets = readSecrets(row);
  if (cfg.transport === 'stdio') {
    if (!cfg.command) throw new Error('Commande manquante');
    return createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...(process.env as Record<string, string>), ...secrets },
      }),
    }) as Promise<Client>;
  }
  if (!cfg.url) throw new Error('URL manquante');
  return createMCPClient({ transport: { type: cfg.transport, url: cfg.url, headers: secrets } }) as Promise<Client>;
}

export async function getMcpClient(row: ConnectorRow): Promise<Client> {
  if (currentAccount()?.role === 'user') throw new Error('Un connecteur MCP avancé nécessite les droits d’administrateur du déploiement.');
  const key = `${accountKey()}:${row.id}`;
  const cached = clients.get(key);
  if (cached && cached.updatedAt >= row.updatedAt) return cached.client;
  if (cached) await closeMcpClient(row.id);
  let pending = connecting.get(key);
  if (!pending) {
    pending = withTimeout(connect(row), 20_000, `Connexion à ${row.name}`).finally(() => connecting.delete(key));
    connecting.set(key, pending);
  }
  const client = await pending;
  clients.set(key, { client, updatedAt: row.updatedAt });
  return client;
}

export async function closeMcpClient(id: string) {
  const key = `${accountKey()}:${id}`;
  const entry = clients.get(key);
  clients.delete(key);
  await entry?.client.close().catch(() => {});
}

export async function closeAllMcpClients() {
  await Promise.all([...clients.values()].map((entry) => entry.client.close().catch(() => {})));
  clients.clear();
}

/** Connecte le serveur, met à jour la liste des outils et l'état du connecteur. */
export async function refreshMcpConnector(id: string): Promise<ConnectorRow> {
  const row = await getConnector(id);
  if (!row) throw new Error('Connecteur introuvable');
  await closeMcpClient(id);
  try {
    const client = await getMcpClient(row);
    const listed = await withTimeout(client.listTools(), 15_000, 'Liste des outils');
    const tools = listed.tools.map((t) => ({ name: t.name, description: (t.description ?? '').slice(0, 300) }));
    return await updateConnector(id, { status: 'ok', lastError: null, tools });
  } catch (err) {
    await closeMcpClient(id);
    return updateConnector(id, { status: 'error', lastError: errorMessage(err) });
  }
}

export function mcpToolName(row: Pick<ConnectorRow, 'name' | 'id'>, toolName: string): string {
  return `mcp_${connectorSlug(row)}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** Résultat MCP → texte lisible, marqué comme donnée externe. */
function normalizeResult(result: any) {
  if (result && Array.isArray(result.content)) {
    const text = result.content
      .map((c: any) => (c.type === 'text' ? c.text : c.type === 'resource' ? JSON.stringify(c.resource) : `[${c.type}]`))
      .join('\n');
    return { ok: !result.isError, untrusted_content: truncate(text, 20_000), ...(result.isError ? { error: truncate(text, 2000) } : {}) };
  }
  return { ok: true, untrusted_content: truncate(JSON.stringify(result ?? null), 20_000) };
}

export async function callMcpTool(connectorId: string, toolName: string, args: unknown) {
  const row = await getConnector(connectorId);
  if (!row || !row.enabled) throw new Error('Connecteur indisponible');
  const client = await getMcpClient(row);
  const tools = await client.tools();
  const t = (tools as ToolSet)[toolName];
  if (!t?.execute) throw new Error(`Outil ${toolName} introuvable sur ${row.name}`);
  const result = await t.execute(args as never, { toolCallId: `mcp-${Date.now()}`, messages: [] } as never);
  return normalizeResult(result);
}

/**
 * Outils MCP exposés à un tour. Les connecteurs en mode « ask » produisent une
 * demande de validation au lieu d'exécuter directement l'appel.
 */
export async function mcpToolsForTurn(
  requestApproval: (connector: ConnectorRow, toolName: string, args: unknown, toolCallId: string) => Promise<unknown>,
): Promise<{ tools: ToolSet; connectors: { id: string; name: string; tools: number; status: string; names: string[] }[] }> {
  const rows = (await listConnectors('mcp')).filter((c) => c.enabled);
  const out: ToolSet = {};
  const summary: { id: string; name: string; tools: number; status: string; names: string[] }[] = [];
  await Promise.all(
    rows.map(async (row) => {
      try {
        const client = await getMcpClient(row);
        const tools = (await withTimeout(client.tools(), 15_000, 'Outils MCP')) as ToolSet;
        for (const [name, original] of Object.entries(tools)) {
          out[mcpToolName(row, name)] = tool({
            description: `[Connecteur ${row.name}${row.approval === 'ask' ? ' — chaque appel demande la validation de l’utilisateur' : ''}] ${original.description ?? name}`,
            inputSchema: original.inputSchema as any,
            execute: async (args: unknown, options: { toolCallId: string }) => {
              if (row.approval === 'ask') return requestApproval(row, name, args, options.toolCallId);
              try {
                return normalizeResult(await original.execute!(args as never, options as never));
              } catch (err) {
                return { ok: false, error: errorMessage(err) };
              }
            },
          });
        }
        summary.push({ id: row.id.slice(-8), name: row.name, tools: Object.keys(tools).length, status: 'ok', names: Object.keys(tools).map((n) => mcpToolName(row, n)) });
      } catch (err) {
        await closeMcpClient(row.id);
        if (row.status !== 'error') await updateConnector(row.id, { status: 'error', lastError: errorMessage(err) }).catch(() => {});
        summary.push({ id: row.id.slice(-8), name: row.name, tools: 0, names: [], status: `indisponible (${errorMessage(err).slice(0, 80)})` });
      }
    }),
  );
  return { tools: out, connectors: summary };
}
