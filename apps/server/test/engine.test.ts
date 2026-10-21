import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, openDatabase, schema } from '../src/db/client.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { createActivity, getActivity } from '../src/activities/repo.ts';
import { checkWatch, ingestWebhook, tick } from '../src/life/engine.ts';
import { enqueue, registerJobHandler, startQueue, stopQueue } from '../src/jobs/queue.ts';
import { createApproval, getApproval, registerApprovalAction, resolveApproval } from '../src/approvals/service.ts';
import { buildTools } from '../src/agents/tools.ts';
import { remember, searchMemories, contextMemories } from '../src/memory/repo.ts';
import { sleep } from '../src/util.ts';
import { getSearchSettings, setSearchSettings, getSetting } from '../src/settings.ts';

let server: Server;
let page = '<html><body><p>Prix : 349 €</p></body></html>';
let baseUrl = '';

beforeAll(async () => {
  await openDatabase({ memory: true });
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/produit`;
});

afterAll(async () => {
  await stopQueue();
  server.close();
  await closeDatabase();
});

async function wakeJobs(agentId: string) {
  return db()
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.agentId, agentId));
}

describe('compagnons', () => {
  it('crée un compagnon avec sa conversation principale', async () => {
    const a = await createAgent({ named: false });
    expect(a.name).toBe('Compagnon');
    expect(a.named).toBe(false);
    const conv = await mainConversationId(a.id);
    expect(await mainConversationId(a.id)).toBe(conv);
  });
});

describe('recherche sans compte', () => {
  it('remplace les anciens moteurs par le mode libre sans lire leurs clés', async () => {
    const { setSetting } = await import('../src/settings.ts');
    await setSetting('search.config', { provider: 'serper', apiKey: 'ancienne-cle-non-dechiffrable', url: 'https://ancien.example' });
    expect(await getSearchSettings()).toEqual({ provider: 'auto', url: null });
    await setSearchSettings({ provider: 'searxng', url: 'http://localhost:8888' });
    expect(await getSearchSettings()).toEqual({ provider: 'searxng', url: 'http://localhost:8888' });
    expect((await getSetting('search.config'))?.apiKey).toBeUndefined();
    await setSearchSettings({ provider: 'auto' });
  });
});

describe('surveillances sans LLM', () => {
  it('ne réveille le compagnon que lorsque la page change', async () => {
    const agent = await createAgent({ name: 'Homey' });
    const act = await createActivity({
      agentId: agent.id,
      title: 'Prix écran',
      kind: 'watch',
      instructions: 'Préviens-moi',
      watch: { url: baseUrl, mode: 'changed' },
      tz: 'UTC',
    });
    const first = await checkWatch((await getActivity(act.id))!);
    expect(first.triggered).toBe(false);
    const second = await checkWatch((await getActivity(act.id))!);
    expect(second.triggered).toBe(false);
    page = '<html><body><p>Prix : 289 €</p></body></html>';
    const third = await checkWatch((await getActivity(act.id))!);
    expect(third.triggered).toBe(true);
    const jobs = await wakeJobs(agent.id);
    expect(jobs.filter((j) => j.type === 'agent.wake')).toHaveLength(1);
  });

  it('déclenche « contains » uniquement au passage faux → vrai', async () => {
    const agent = await createAgent({ name: 'Watcher' });
    page = '<p>Rupture de stock</p>';
    const act = await createActivity({
      agentId: agent.id,
      title: 'Stock',
      kind: 'watch',
      instructions: 'Préviens-moi',
      watch: { url: baseUrl, mode: 'contains', value: 'en stock' },
      tz: 'UTC',
    });
    expect((await checkWatch((await getActivity(act.id))!)).triggered).toBe(false);
    page = '<p>Produit en stock</p>';
    expect((await checkWatch((await getActivity(act.id))!)).triggered).toBe(true);
    expect((await checkWatch((await getActivity(act.id))!)).triggered).toBe(false);
  });
});

describe('scheduler', () => {
  it('rattrape une seule fois une échéance manquée et désactive une planification unique', async () => {
    const agent = await createAgent({ name: 'Sched' });
    const act = await createActivity({
      agentId: agent.id,
      title: 'Rappel',
      kind: 'schedule',
      instructions: 'Rappelle',
      schedule: { type: 'once', at: new Date(Date.now() + 60_000).toISOString() },
      tz: 'UTC',
    });
    // Simule un arrêt : l'échéance est passée depuis 10 minutes.
    await db().update(schema.activities).set({ nextRunAt: new Date(Date.now() - 600_000) }).where(eq(schema.activities.id, act.id));
    await tick();
    await tick();
    const jobs = (await wakeJobs(agent.id)).filter((j) => j.type === 'agent.wake');
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as any).text).toContain('en retard');
    const after = await getActivity(act.id);
    expect(after?.enabled).toBe(false);
    expect(after?.nextRunAt).toBeNull();
  });
});

describe('webhooks', () => {
  it('déduplique les événements', async () => {
    const agent = await createAgent({ name: 'Hooky' });
    const act = await createActivity({ agentId: agent.id, title: 'Maison', kind: 'webhook', instructions: 'Résume', tz: 'UTC' });
    expect(act.webhookToken).toMatch(/^wh_/);
    expect((await ingestWebhook(act, { porte: 'ouverte' }, 'evt-1')).accepted).toBe(true);
    expect((await ingestWebhook(act, { porte: 'ouverte' }, 'evt-1')).duplicate).toBe(true);
  });
});

describe('file de tâches durable', () => {
  it('exécute, relance après échec et déduplique', async () => {
    let calls = 0;
    registerJobHandler('test.flaky', async () => {
      calls++;
      if (calls === 1) throw new Error('panne passagère');
    });
    await startQueue();
    expect(await enqueue('test.flaky', {}, { dedupeKey: 'flaky-1' })).toBe(true);
    expect(await enqueue('test.flaky', {}, { dedupeKey: 'flaky-1' })).toBe(false);
    await sleep(500);
    // Après l'échec, la tâche est replanifiée : on avance son échéance.
    await db().update(schema.jobs).set({ runAt: new Date() }).where(eq(schema.jobs.dedupeKey, 'flaky-1'));
    for (let i = 0; i < 30 && calls < 2; i++) await sleep(200);
    await sleep(300);
    const [job] = await db().select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, 'flaky-1'));
    expect(calls).toBe(2);
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(2);
  });
});

describe('approbations', () => {
  it("n'exécute l'action qu'une fois, après validation", async () => {
    let executed = 0;
    registerApprovalAction('test.action', async (input: { v: number }) => {
      executed++;
      return { doubled: input.v * 2 };
    });
    const agent = await createAgent({ name: 'Approver' });
    const ap = await createApproval({ agentId: agent.id, conversationId: await mainConversationId(agent.id), action: 'test.action', summary: 'Tester', input: { v: 21 } });
    expect(executed).toBe(0);
    const res = await resolveApproval(ap.id, 'approve', { by: 'ui', notifyAgent: false });
    expect(res.status).toBe('executed');
    expect(res.result).toEqual({ doubled: 42 });
    await expect(resolveApproval(ap.id, 'approve', { by: 'ui', notifyAgent: false })).rejects.toThrow(/déjà été traitée/);
    expect(executed).toBe(1);
  });

  it('une extension de permissions demandée en conversation attend une validation', async () => {
    const agent = (await getAgent((await createAgent({ name: 'Perm' })).id))!;
    const tools = buildTools({ agent, conversationId: await mainConversationId(agent.id), isMain: true, userTurn: true, depth: 0, tz: 'UTC' });
    const out: any = await tools.agent_update_permissions.execute!({ createAgents: 'allow' } as any, { toolCallId: 't1', messages: [] } as any);
    expect(out.status).toBe('pending_approval');
    const ap = await getApproval(out.approvalId);
    expect(ap?.status).toBe('pending');
    expect((await getAgent(agent.id))?.permissions.createAgents).toBe('ask');
    // Une restriction s'applique directement.
    const out2: any = await tools.agent_update_permissions.execute!({ web: false } as any, { toolCallId: 't2', messages: [] } as any);
    expect(out2.ok).toBe(true);
    expect((await getAgent(agent.id))?.permissions.web).toBe(false);
  });
});

describe('sécurité des outils', () => {
  it("n'expose pas les outils de configuration lors d'un réveil autonome", async () => {
    const agent = (await getAgent((await createAgent({ name: 'Auto' })).id))!;
    const conv = await mainConversationId(agent.id);
    const autonomous = buildTools({ agent, conversationId: conv, isMain: true, userTurn: false, depth: 0, tz: 'UTC' });
    const direct = buildTools({ agent, conversationId: conv, isMain: true, userTurn: true, depth: 0, tz: 'UTC' });
    for (const name of ['agent_update_profile', 'agent_update_instructions', 'agent_update_permissions', 'agent_configure_model', 'approval_respond']) {
      expect(autonomous[name]).toBeUndefined();
      expect(direct[name]).toBeDefined();
    }
    expect(autonomous.activity_create).toBeDefined();
  });

  it('la création autonome d’un compagnon passe par une validation', async () => {
    const agent = (await getAgent((await createAgent({ name: 'Creator' })).id))!;
    const tools = buildTools({ agent, conversationId: await mainConversationId(agent.id), isMain: true, userTurn: false, depth: 0, tz: 'UTC' });
    const out: any = await tools.agent_create.execute!({ name: 'Dev', description: 'Développement' } as any, { toolCallId: 't3', messages: [] } as any);
    expect(out.status).toBe('pending_approval');
  });
});

describe('mémoire', () => {
  it('retrouve les souvenirs pertinents', async () => {
    const agent = await createAgent({ name: 'Memo' });
    await remember(agent.id, "L'utilisateur préfère des réponses courtes", 'preference');
    await remember(agent.id, 'Projet Venthone : migration des serveurs en novembre', 'project');
    const found = await searchMemories(agent.id, 'Où en est la migration Venthone ?');
    expect(found[0]?.content).toContain('Venthone');
    const ctx = await contextMemories(agent.id, 'bonjour');
    expect(ctx.length).toBe(2);
  });
});
