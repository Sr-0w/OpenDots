import { asSchema, tool, type ToolSet } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.ts';

/**
 * Chargement à la demande des outils de connecteurs (svc_*) et MCP (mcp_*).
 * Chaque tour reçoit les outils de base, un catalogue compact dans le prompt et
 * deux méta-outils. Les outils chargés deviennent appelables dès l'étape
 * suivante du même tour (activeTools via prepareStep) et restent chargés pour
 * la conversation tant que les permissions les exposent.
 */
export interface ToolGroup { id: string; name: string; kind: 'service' | 'mcp'; status: string; tools: string[] }
export interface LazyTools { groups: ToolGroup[]; names: Set<string>; loaded: Set<string> }

const settingKey = (conversationId: string) => `tools.loaded:${conversationId}`;

export async function loadedToolsFor(conversationId: string): Promise<string[]> {
  const [row] = await db().select().from(schema.settings).where(eq(schema.settings.key, settingKey(conversationId)));
  return Array.isArray(row?.value) ? (row!.value as unknown[]).filter((v): v is string => typeof v === 'string') : [];
}

async function saveLoaded(conversationId: string, names: string[]) {
  const value = [...new Set(names)].sort();
  await db().insert(schema.settings).values({ key: settingKey(conversationId), value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

/** Outils actifs : tout sauf les outils paresseux non chargés. */
export function activeToolNames(tools: ToolSet, lazy: LazyTools): string[] {
  return Object.keys(tools).filter((n) => !lazy.names.has(n) || lazy.loaded.has(n));
}

const oneLine = (s: string | undefined, max = 140) => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};

export function compactCatalog(lazy: LazyTools): string[] {
  return lazy.groups.map((g) => `${g.kind === 'mcp' ? 'MCP' : 'Service'} « ${g.name} » [${g.id}] : ${g.status === 'ok' ? `${g.tools.length} action(s), ${g.tools.filter((n) => lazy.loaded.has(n)).length} chargée(s)` : g.status}`);
}

/** Construit l'état paresseux et ajoute list_capabilities / load_tools à `tools`. */
export async function attachLazyTools(tools: ToolSet, groups: ToolGroup[], conversationId: string): Promise<LazyTools> {
  const names = new Set(groups.flatMap((g) => g.tools).filter((n) => n in tools));
  const stored = await loadedToolsFor(conversationId);
  // Un outil dont la permission a été retirée n'est plus proposé.
  const loaded = new Set(stored.filter((n) => names.has(n)));
  if (loaded.size !== stored.length) await saveLoaded(conversationId, [...loaded]);
  const lazy: LazyTools = { groups, names, loaded };
  if (!groups.length) return lazy;
  const describe = (n: string) => oneLine((tools[n] as any)?.description);
  tools.list_capabilities = tool({
    description: 'Liste les services connectés et connecteurs MCP avec leurs actions (noms et descriptions). À appeler avant de dire qu’une action est impossible.',
    inputSchema: z.object({ filter: z.string().max(100).optional().describe('Filtre facultatif (nom de service, id ou mot-clé d’action)') }).strict(),
    execute: async ({ filter }) => {
      const f = filter?.toLowerCase().trim();
      const out = groups.map((g) => {
        const groupMatch = !f || g.name.toLowerCase().includes(f) || g.id.toLowerCase() === f;
        const actions = g.tools.filter((n) => names.has(n) && (groupMatch || n.toLowerCase().includes(f!) || describe(n).toLowerCase().includes(f!)));
        return { id: g.id, name: g.name, kind: g.kind, status: g.status, actions: actions.map((n) => ({ name: n, description: describe(n), loaded: loaded.has(n) })) };
      }).filter((g) => g.actions.length || (!f && g.status !== 'ok'));
      return { ok: true, connectors: out, note: 'Appelle load_tools avec les noms d’actions (ou l’id du service) pour pouvoir les utiliser.' };
    },
  });
  tools.load_tools = tool({
    description: 'Charge des actions de services/MCP (noms exacts ou id de service) ; elles deviennent appelables immédiatement et le restent dans cette conversation.',
    inputSchema: z.object({ names: z.array(z.string().min(1).max(200)).min(1).max(40) }).strict(),
    execute: async ({ names: wanted }) => {
      const added: string[] = [], unknown: string[] = [];
      for (const w of wanted) {
        const group = groups.find((g) => g.id === w || g.name === w);
        const hits = group ? group.tools.filter((n) => names.has(n)) : names.has(w) ? [w] : [];
        if (!hits.length) unknown.push(w);
        for (const n of hits) { if (!loaded.has(n)) added.push(n); loaded.add(n); }
      }
      if (added.length) await saveLoaded(conversationId, [...loaded]);
      const loadedTools = await Promise.all([...new Set(wanted.flatMap((w) => groups.find((g) => g.id === w || g.name === w)?.tools ?? [w]))].filter((n) => loaded.has(n)).map(async (n) => ({ name: n, description: describe(n), input_schema: await asSchema((tools[n] as any).inputSchema).jsonSchema })));
      return { ok: unknown.length === 0, loaded: loadedTools, ...(unknown.length ? { unknown, note: 'Noms inconnus ou non autorisés : vérifie avec list_capabilities.' } : {}), next: 'Ces outils sont maintenant appelables directement.' };
    },
  });
  return lazy;
}
