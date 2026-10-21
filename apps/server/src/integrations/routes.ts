import { enqueue } from '../jobs/queue.ts';
import { getAgent } from '../agents/repo.ts';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { CATALOG } from './catalog.ts';
import { oauth, oauthApps, oauthCookieName, saveOAuthApp } from './oauth.ts';
import { availableOperations } from './providers.ts';
import { ConnectorError, deleteConnector, getConnector, toConnectorDTO, updateConnector } from '../connectors/repo.ts';
import { appOrigin } from '../auth/routes.ts';
import type { IntegrationConfig } from '@opendots/shared';

const provider = z.enum(['google-drive', 'google-calendar', 'gmail', 'outlook', 'github']);
const issuer = z.enum(['google', 'microsoft', 'github']);
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function integrationRoutes() {
  const app = new Hono();
  app.onError((error, c) => c.json({ error: error instanceof ConnectorError || error instanceof z.ZodError ? error.message : 'Connexion au fournisseur impossible.' }, 400));
  app.get('/catalog', async (c) => c.json({ entries: CATALOG, apps: await oauthApps(appOrigin(c)) }));
  app.put('/oauth/apps/:provider', async (c) => {
    const p = issuer.parse(c.req.param('provider'));
    const body = z.object({ clientId: z.string().min(1).max(2000), clientSecret: z.string().max(4000).optional() }).strict().parse(await c.req.json());
    await saveOAuthApp(p, body);
    return c.json({ apps: await oauthApps(appOrigin(c)) });
  });
  app.post('/oauth/start', async (c) => {
    const body = z.object({ provider, permissions: z.array(z.string()).min(1).max(12), connectorId: z.string().optional(), requestedBy: z.string().optional() }).strict().parse(await c.req.json());
    const result = await oauth.begin(body.provider, body.permissions, appOrigin(c), body.connectorId, body.requestedBy);
    setCookie(c, result.cookieName, result.cookie, { httpOnly: true, secure: appOrigin(c).startsWith('https:'), sameSite: 'Lax', path: '/api/integrations/oauth/callback', maxAge: 600 });
    return c.json({ url: result.url, expiresAt: result.expiresAt });
  });
  app.get('/oauth/callback/:provider', async (c) => {
    c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
    const state = c.req.query('state') ?? '';
    const cookieName = oauthCookieName(state);
    try {
      const result = await oauth.complete(issuer.parse(c.req.param('provider')), { state, cookie: getCookie(c, cookieName), code: c.req.query('code'), error: c.req.query('error') });
      deleteCookie(c, cookieName, { path: '/api/integrations/oauth/callback' });
      await updateConnector(result.connector.id, { tools: availableOperations(result.connector.config as IntegrationConfig).map((o) => ({ name: o.id, description: o.name })) });
      if (result.requestedBy) {
        const agent = await getAgent(result.requestedBy);
        if (agent && !agent.archived) await enqueue('agent.wake', { agentId: agent.id, event: { type: 'system', title: 'Nouvelle connexion' }, text: `${result.connector.name} est connecté. Reprends la tâche qui nécessitait cette connexion. Les écritures attendent toujours la validation de l’utilisateur.`, depth: 0 }, { agentId: agent.id });
      }
      // No token, code, account contents or state are exposed to window.opener.
      return c.html(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>OpenDots — connexion établie</title><body><p>Connexion établie. Tu peux fermer cet onglet.</p><script>if(window.opener){window.opener.postMessage({type:'opendots:oauth',ok:true},${JSON.stringify(result.origin)});window.close()}</script></body></html>`);
    } catch (error) {
      deleteCookie(c, cookieName, { path: '/api/integrations/oauth/callback' });
      const message = error instanceof ConnectorError ? error.message : 'Connexion impossible. Recommence depuis OpenDots.';
      return c.html(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>OpenDots — connexion refusée</title><body><p>${escape(message)}</p><p>Tu peux fermer cet onglet et recommencer depuis OpenDots.</p></body></html>`, 400);
    }
  });
  app.post('/:id/disconnect', async (c) => {
    const row = await getConnector(c.req.param('id'));
    if (!row || row.kind !== 'integration') return c.json({ error: 'Connexion introuvable.' }, 404);
    const body = z.object({ revoke: z.boolean().default(false) }).strict().parse(await c.req.json());
    const warning = body.revoke ? await oauth.revoke(row) : null;
    await deleteConnector(row.id);
    return c.json({ ok: true, warning });
  });
  app.post('/:id/test', async (c) => {
    const row = await getConnector(c.req.param('id'));
    if (!row || row.kind !== 'integration' || !row.enabled) return c.json({ error: 'Connexion introuvable ou désactivée.' }, 404);
    try {
      const p = CATALOG.find((s) => s.id === row.config.provider)!.oauth!;
      const account = await oauth.identity(p, await oauth.accessToken(row));
      if (account.id !== row.config.account.id) throw new ConnectorError('Le jeton ne correspond pas au compte enregistré. Reconnecte ce compte.');
      const updated = await updateConnector(row.id, { status: 'ok', lastError: null });
      return c.json({ ok: true, connector: toConnectorDTO(updated) });
    } catch (error) {
      await updateConnector(row.id, { status: 'error', lastError: 'Vérification refusée. Reconnecte ce compte.' });
      throw error;
    }
  });
  return app;
}
