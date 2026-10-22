import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { withDesktopAgent, desktopAgentId, desktopKey } from './session.ts';
import { z } from 'zod';
import { Hono } from 'hono';
import { DesktopError, desktopStatus, readScreenshot, screenshot, startDesktop, stopDesktop, setHumanControl } from './desktop.ts';
import { getSetting, setSetting } from '../settings.ts';
import { getAgent, listAgentRows, updateAgent } from '../agents/repo.ts';
import { enqueue } from '../jobs/queue.ts';
import { KeyedMutex } from '../util.ts';
import { desktopPermissionsSchema, getDesktopPermissions, setDesktopPermissions } from './permissions.ts';

const starts = new KeyedMutex();
export function desktopRoutes() {
  const app = new Hono();
  app.onError((error, c) => c.json({ error: error instanceof DesktopError ? error.message : 'Le bureau graphique est indisponible.' }, 400));
  app.use('*', async (c, next) => {
    if (c.req.path.includes('/desktop/permissions')) return next();
    const agentId = c.req.query('agentId');
    if (!agentId && c.req.path.includes('/screenshots/')) return next(); // historical account-level artifacts only
    if (!agentId || !/^ag_[a-zA-Z0-9_]+$/.test(agentId)) return c.json({ error: 'Sélectionne un compagnon.' }, 400);
    const agent = await getAgent(agentId);
    if (!agent || agent.archived) return c.json({ error: 'Compagnon introuvable.' }, 404);
    return withDesktopAgent(agentId, next);
  });
  app.get('/desktop', async (c) => c.json(await desktopStatus()));
  app.get('/desktop/permissions', async (c) => {
    const entries = await Promise.all((await listAgentRows()).map(async (agent) => [agent.id, await getDesktopPermissions(agent.id)]));
    return c.json(Object.fromEntries(entries));
  });
  app.put('/desktop/permissions/:agentId', async (c) => {
    const agent = await getAgent(c.req.param('agentId'));
    if (!agent || agent.archived) return c.json({ error: 'Compagnon introuvable.' }, 404);
    const parsed = desktopPermissionsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Permissions du bureau invalides.' }, 400);
    return c.json(await setDesktopPermissions(agent.id, parsed.data));
  });
  app.post('/desktop/start', async (c) => starts.run(desktopKey(), async () => {
    const body = z.object({ notify: z.boolean().default(false) }).strict().parse(await c.req.json().catch(() => ({})));
    const previous = await desktopStatus();
    const agent = (await getAgent(desktopAgentId()))!;
    if (!agent.permissions.computer) await updateAgent(agent.id, { permissions: { ...agent.permissions, computer: true } });
    await setSetting(`desktop.bot.${desktopAgentId()}`, { ...await getSetting(`desktop.bot.${desktopAgentId()}`), enabled: true });
    await startDesktop();
    if (body.notify && (!previous.running || previous.suspended)) await enqueue('agent.wake', { agentId: agent.id, event: { type: 'system', title: 'Ordinateur prêt' }, text: 'L’utilisateur a activé ton accès au bureau et démarré ton ordinateur depuis la carte du chat. Reprends la tâche qui le nécessitait. Le bureau XFCE est prêt, sans navigateur ouvert automatiquement. Observe-le avant d’agir.', depth: 0 }, { agentId: agent.id });
    return c.json(await desktopStatus());
  }));
  app.post('/desktop/stop', async (c) => { await stopDesktop(); return c.json(await desktopStatus()); });
  app.post('/desktop/control', async (c) => {
    const body = z.object({ enabled: z.boolean() }).strict().parse(await c.req.json());
    await setHumanControl(body.enabled); return c.json({ ok: true });
  });
  app.post('/screenshot', async (c) => c.json(await screenshot()));
  app.get('/screenshots/:id', async (c) => {
    const id = c.req.param('id');
    const image = c.req.query('agentId') ? await readScreenshot(id) : /^[a-f0-9]{32}$/.test(id) ? await readFile(join(config.dataDir, 'screenshots', `${id}.png`)).catch(() => null) : null;
    if (!image) return c.json({ error: 'Capture introuvable.' }, 404);
    c.header('Content-Type', 'image/png'); c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(image));
  });
  return app;
}
