import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authStore, closeAuthStore } from '../src/auth/store.ts';
import { withAccount, type AccountContext } from '../src/auth/context.ts';
import { closeAllDatabases, openDatabase } from '../src/db/client.ts';
import { createConnector, getConnector, listConnectors, readSecrets, replaceConnectorSecrets, toConnectorDTO, updateConnector } from '../src/connectors/repo.ts';
import { OAuthManager, oauth, oauthApps, saveOAuthApp } from '../src/integrations/oauth.ts';
import { CATALOG, hasGrantedScopes, integrationSpec, selectedScopes } from '../src/integrations/catalog.ts';
import { IntegrationExecutor, OPERATIONS, availableOperations } from '../src/integrations/providers.ts';
import { gitPushArgs } from '../src/computer/shell.ts';
import { createAgent, getAgent, mainConversationId, updateAgent } from '../src/agents/repo.ts';
import { buildCapabilityTools } from '../src/agents/capability-tools.ts';
import { getApproval, resolveApproval } from '../src/approvals/service.ts';
import { createApi } from '../src/api/routes.ts';
import { config } from '../src/config.ts';
import type { IntegrationProvider, OAuthProvider } from '@opendots/shared';

const a: AccountContext = { id: 'integration-alice', email: 'alice@example.com', role: 'user', dataDir: `${config.dataDir}/integration-alice` };
const b: AccountContext = { ...a, id: 'integration-bob', email: 'bob@example.com', dataDir: `${config.dataDir}/integration-bob` };
const admin = { ...a, role: 'admin' as const };
const nativeFetch = globalThis.fetch;
const calls: { url: URL; method: string; body: string; authorization?: string }[] = [];
let server: Server, origin: string, now = Date.now(), tokenStatus = 200, apiStatus = 200;
let tokenValue: Record<string, unknown> = {}, userId = 'provider-user';
const transport: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const target = new URL(url.pathname + url.search, origin);
  target.searchParams.set('__provider_host', url.hostname);
  return nativeFetch(target, init);
};
const asA = <T>(fn: () => T) => withAccount(a, fn);
const oauthFlow = async (manager: OAuthManager, provider: IntegrationProvider, permissions = ['read'], connectorId?: string) => {
  const start = await manager.begin(provider, permissions, 'https://app.example', connectorId);
  const state = new URL(start.url).searchParams.get('state')!;
  return { start, state, issuer: integrationSpec(provider).oauth };
};
const finish = async (manager: OAuthManager, provider: IntegrationProvider, permissions = ['read'], connectorId?: string) => {
  const { start, state, issuer } = await oauthFlow(manager, provider, permissions, connectorId);
  return manager.complete(issuer, { state, cookie: start.cookie, code: 'fixture-code' });
};
beforeAll(async () => {
  await authStore(true);
  await withAccount(a, () => openDatabase({ memory: true }));
  await withAccount(b, () => openDatabase({ memory: true }));
  for (const provider of ['google', 'microsoft', 'github'] as const) {
    process.env[`OPENDOTS_${provider.toUpperCase()}_CLIENT_ID`] = `fixture-${provider}`;
    process.env[`OPENDOTS_${provider.toUpperCase()}_CLIENT_SECRET`] = `private-${provider}`;
  }
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url!, 'http://fixture');
    calls.push({ url, method: req.method!, body, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/token') || url.pathname.endsWith('/access_token')) {
      res.statusCode = tokenStatus;
      res.end(JSON.stringify({ access_token: 'access-private', refresh_token: 'refresh-private', token_type: 'Bearer', expires_in: 3600, ...tokenValue }));
    } else if (url.pathname === '/v1/userinfo' || url.pathname === '/v1.0/me' || url.pathname === '/user') {
      res.end(JSON.stringify({ sub: userId, id: userId, email: 'account@example.com', mail: 'account@example.com', login: 'account' }));
    } else {
      res.statusCode = apiStatus;
      if (url.pathname === '/drive/v3/files/file' && !url.searchParams.has('alt')) res.end(JSON.stringify({ id: 'file', name: 'Document', mimeType: 'application/vnd.google-apps.document' }));
      else if (url.pathname.endsWith('/export')) { res.setHeader('Content-Type', 'text/plain'); res.end('Texte réel du serveur de test.'); }
      else if (url.pathname === '/gmail/v1/users/me/messages') res.end(JSON.stringify({ messages: [{ id: 'message' }] }));
      else if (url.pathname === '/gmail/v1/users/me/messages/message') res.end(JSON.stringify({ id: 'message', payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Bonjour' }], body: { data: Buffer.from('Message test').toString('base64url') } } }));
      else if (url.pathname === '/v1.0/me/messages/message') res.end(JSON.stringify({ id: 'message', body: { contentType: 'HTML', content: '<p>Message Outlook</p>' } }));
      else res.end(JSON.stringify({ id: 'created', value: [], items: [], files: [] }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); tokenValue = {}; tokenStatus = 200; apiStatus = 200; userId = 'provider-user'; calls.length = 0; });
afterAll(async () => {
  for (const provider of ['google', 'microsoft', 'github']) { delete process.env[`OPENDOTS_${provider.toUpperCase()}_CLIENT_ID`]; delete process.env[`OPENDOTS_${provider.toUpperCase()}_CLIENT_SECRET`]; }
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await closeAllDatabases(); await closeAuthStore();
});

describe('OAuth avec échanges HTTP locaux réels', () => {
  it.each(['google-drive', 'outlook', 'github'] as const)('échange le code %s avec PKCE, chiffre les jetons et empêche leur exposition', async (provider) => asA(async () => {
    const manager = new OAuthManager(transport, () => now);
    const { start, state, issuer } = await oauthFlow(manager, provider);
    const authorize = new URL(start.url);
    expect(authorize.protocol).toBe('https:'); expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const { connector } = await manager.complete(issuer, { state, cookie: start.cookie, code: 'fixture-code' });
    const exchange = calls.find((c) => c.method === 'POST')!;
    const form = new URLSearchParams(exchange.body);
    expect(form.get('client_secret')).toBe(`private-${issuer}`);
    expect(form.get('redirect_uri')).toBe(`https://app.example/api/integrations/oauth/callback/${issuer}`);
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(authorize.searchParams.get('code_challenge'));
    expect(readSecrets(connector).refresh_token).toBe('refresh-private');
    expect(JSON.stringify(connector.secret)).not.toContain('refresh-private');
    expect(JSON.stringify(toConnectorDTO(connector))).not.toMatch(/access-private|refresh-private|private-google|private-microsoft|private-github/);
    await expect(manager.complete(issuer, { state, cookie: start.cookie, code: 'replay' })).rejects.toThrow('état OAuth');
  }));
  it('refuse mauvais navigateur, autre compte, autre fournisseur et état inconnu sans échange de jeton', async () => {
    const manager = new OAuthManager(transport, () => now);
    const { start, state } = await asA(() => oauthFlow(manager, 'gmail'));
    await expect(asA(() => manager.complete('google', { state, cookie: 'wrong', code: 'code' }))).rejects.toThrow('navigateur');
    await expect(withAccount(b, () => manager.complete('google', { state, cookie: start.cookie, code: 'code' }))).rejects.toThrow('état OAuth');
    await expect(asA(() => manager.complete('github', { state, cookie: start.cookie, code: 'code' }))).rejects.toThrow('état OAuth');
    await expect(asA(() => manager.complete('google', { state: 'unknown', cookie: start.cookie, code: 'code' }))).rejects.toThrow('état OAuth');
    expect(calls).toHaveLength(0);
  });
  it('consomme un refus, expire après dix minutes et interdit HTTP public', async () => asA(async () => {
    const manager = new OAuthManager(transport, () => now);
    let { start, state } = await oauthFlow(manager, 'gmail');
    await expect(manager.complete('google', { state, cookie: start.cookie, error: 'access_denied' })).rejects.toThrow('refusée');
    await expect(manager.complete('google', { state, cookie: start.cookie, code: 'replay' })).rejects.toThrow('état OAuth');
    ({ start, state } = await oauthFlow(manager, 'gmail'));
    now += 600_001;
    await expect(manager.complete('google', { state, cookie: start.cookie, code: 'code' })).rejects.toThrow('expirée');
    await expect(manager.begin('gmail', ['read'], 'http://public.example')).rejects.toThrow('HTTPS');
    expect(calls).toHaveLength(0);
  }));
  it('refuse les permissions partielles et les jetons malformés', async () => asA(async () => {
    const manager = new OAuthManager(transport, () => now);
    tokenValue = { scope: 'openid email' };
    await expect(finish(manager, 'gmail', ['read', 'send'])).rejects.toThrow('permissions');
    tokenValue = { expires_in: -1 };
    await expect(finish(manager, 'gmail')).rejects.toThrow('jeton');
    tokenValue = { access_token: 42 };
    await expect(finish(manager, 'gmail')).rejects.toThrow('jeton');
    expect(calls.every((c) => c.method === 'POST')).toBe(true);
  }));
  it('reconnecte le même compte sans doublon et rejette un autre compte', async () => asA(async () => {
    const manager = new OAuthManager(transport, () => now);
    const { connector } = await finish(manager, 'gmail');
    expect((await finish(manager, 'gmail', ['read'], connector.id)).connector.id).toBe(connector.id);
    userId = 'different-account';
    await expect(finish(manager, 'gmail', ['read'], connector.id)).rejects.toThrow('ne correspond pas');
    expect((await listConnectors('integration')).filter((c) => c.config.provider === 'gmail')).toHaveLength(1);
    await expect(withAccount(b, () => manager.begin('gmail', ['read'], 'https://app.example', connector.id))).rejects.toThrow('introuvable');
  }));
  it('sérialise les renouvellements concurrents et conserve le nouveau refresh token chiffré', async () => asA(async () => {
    const manager = new OAuthManager(transport, () => now);
    const { connector } = await finish(manager, 'google-calendar');
    now += 3600_001; tokenValue = { access_token: 'new-access', refresh_token: 'rotated-refresh' }; calls.length = 0;
    expect(await Promise.all([manager.accessToken(connector), manager.accessToken(connector)])).toEqual(['new-access', 'new-access']);
    expect(calls).toHaveLength(1); expect(new URLSearchParams(calls[0].body).get('grant_type')).toBe('refresh_token');
    const fresh = (await getConnector(connector.id))!;
    expect(readSecrets(fresh).refresh_token).toBe('rotated-refresh');
    expect(JSON.stringify(toConnectorDTO(fresh))).not.toContain('rotated-refresh');
    now += 3600_001; tokenStatus = 400;
    await expect(manager.accessToken(fresh)).rejects.toThrow('refusé');
    expect((await getConnector(fresh.id))!.status).toBe('error');
  }));
  it('réserve la configuration OAuth à l’administrateur et masque ses secrets', async () => {
    await expect(asA(() => saveOAuthApp('google', { clientId: 'bad', clientSecret: 'bad' }))).rejects.toThrow('administrateur');
    expect((await asA(() => oauthApps('https://app.example'))).every((app) => app.configured && app.clientId === '' && app.hasSecret)).toBe(true);
    delete process.env.OPENDOTS_GITHUB_CLIENT_ID; delete process.env.OPENDOTS_GITHUB_CLIENT_SECRET;
    try {
      await withAccount(admin, () => saveOAuthApp('github', { clientId: 'local-github', clientSecret: 'local-secret' }));
      const stored = (await (await authStore()).query<{value:string}>('SELECT value FROM instance_settings WHERE key=$1', ['oauth:github'])).rows[0].value;
      expect(stored).not.toContain('local-secret');
      expect((await withAccount(admin, () => oauthApps('https://app.example'))).find((app) => app.provider === 'github')).toMatchObject({ configured: true, clientId: 'local-github', source: 'local' });
    } finally { process.env.OPENDOTS_GITHUB_CLIENT_ID = 'fixture-github'; process.env.OPENDOTS_GITHUB_CLIENT_SECRET = 'private-github'; }
  });
  it('révoque via les endpoints officiels et explique la limite Microsoft', async () => asA(async () => {
    const manager = new OAuthManager(transport, () => now);
    for (const provider of ['google-drive', 'github', 'outlook'] as const) {
      const { connector } = await finish(manager, provider); calls.length = 0;
      const warning = await manager.revoke(connector);
      if (provider === 'outlook') { expect(warning).toContain('Microsoft'); expect(calls).toHaveLength(0); }
      else {
        expect(warning).toBeNull(); expect(calls).toHaveLength(1);
        if (provider === 'github') { expect(calls[0].method).toBe('DELETE'); expect(calls[0].url.pathname).toBe('/applications/fixture-github/grant'); }
        else { expect(calls[0].url.pathname).toBe('/revoke'); expect(new URLSearchParams(calls[0].body).get('token')).toBe('refresh-private'); }
      }
    }
  }));
  it('normalise les scopes Microsoft et refuse les permissions inventées', () => {
    expect(hasGrantedScopes(['Mail.Read'], ['https://graph.microsoft.com/Mail.Read'])).toBe(true);
    expect(hasGrantedScopes(['public_repo', 'read:user'], ['repo', 'user'])).toBe(true);
    expect(hasGrantedScopes(['Mail.Read', 'Calendars.Read'], ['Mail.ReadWrite', 'Calendars.ReadWrite'])).toBe(true);
    expect(() => selectedScopes('gmail', ['admin'])).toThrow();
    expect(() => selectedScopes('gmail', [])).toThrow();
  });
});

const message = { to: ['friend@example.com'], subject: 'Énergie solaire', body: 'Bonjour !' };
const event = { title: 'Rendez-vous', start: '2026-10-21T14:00:00+02:00', end: '2026-10-21T15:00:00+02:00', attendees: ['friend@example.com'] };
const cases: Record<string, { args: unknown; path: string; method?: string }> = {
  drive_search: { args: { query: "L'énergie" }, path: '/drive/v3/files' }, drive_read: { args: { file_id: 'file' }, path: '/drive/v3/files/file/export' }, drive_create: { args: { name: 'Note', content: 'Bonjour' }, path: '/upload/drive/v3/files', method: 'POST' },
  calendar_list: { args: {}, path: '/calendar/v3/users/me/calendarList' }, calendar_events: { args: { start: event.start, end: event.end }, path: '/calendar/v3/calendars/primary/events' }, calendar_create: { args: event, path: '/calendar/v3/calendars/primary/events', method: 'POST' },
  gmail_search: { args: { query: 'is:unread' }, path: '/gmail/v1/users/me/messages/message' }, gmail_read: { args: { message_id: 'message' }, path: '/gmail/v1/users/me/messages/message' }, gmail_labels: { args: {}, path: '/gmail/v1/users/me/labels' }, gmail_draft: { args: message, path: '/gmail/v1/users/me/drafts', method: 'POST' }, gmail_send: { args: message, path: '/gmail/v1/users/me/messages/send', method: 'POST' }, gmail_label_create: { args: { name: 'Solaire' }, path: '/gmail/v1/users/me/labels', method: 'POST' },
  outlook_search: { args: { query: 'solaire' }, path: '/v1.0/me/messages' }, outlook_read: { args: { message_id: 'message' }, path: '/v1.0/me/messages/message' }, outlook_send: { args: message, path: '/v1.0/me/sendMail', method: 'POST' }, outlook_draft: { args: message, path: '/v1.0/me/messages', method: 'POST' }, outlook_calendars: { args: {}, path: '/v1.0/me/calendars' }, outlook_events: { args: { start: event.start, end: event.end }, path: '/v1.0/me/calendarView' }, outlook_event_create: { args: event, path: '/v1.0/me/events', method: 'POST' },
  github_repos: { args: {}, path: '/user/repos' }, github_search: { args: { query: 'repo:owner/project is:issue' }, path: '/search/issues' }, github_issue: { args: { repo: 'owner/project', number: 1 }, path: '/repos/owner/project/issues/1' }, github_pulls: { args: { repo: 'owner/project' }, path: '/repos/owner/project/pulls' }, github_issue_create: { args: { repo: 'owner/project', title: 'Test', body: 'Détail' }, path: '/repos/owner/project/issues', method: 'POST' }, github_comment: { args: { repo: 'owner/project', number: 1, body: 'Bonjour' }, path: '/repos/owner/project/issues/1/comments', method: 'POST' },
  github_repo_create: { args: { name: 'nouveau', private: true }, path: '/user/repos', method: 'POST' }, github_branch_create: { args: { repo: 'owner/project', branch: 'feature/x', from: 'a'.repeat(40) }, path: '/repos/owner/project/git/refs', method: 'POST' },
  github_pr_create: { args: { repo: 'owner/project', title: 'PR', head: 'feature/x', base: 'main' }, path: '/repos/owner/project/pulls', method: 'POST' }, github_pr_merge: { args: { repo: 'owner/project', number: 2, method: 'squash' }, path: '/repos/owner/project/pulls/2/merge', method: 'PUT' },
};
const connectorIds = new Map<string, string>();
describe('opérations natives via HTTP réel sur serveur local', () => {
  beforeAll(async () => asA(async () => {
    const manager = new OAuthManager(transport, () => now);
    for (const provider of CATALOG.filter((p) => p.oauth)) connectorIds.set(provider.id, (await finish(manager, provider.id as IntegrationProvider, provider.permissions.map((p) => p.id))).connector.id);
  }));
  it.each(OPERATIONS.filter((o) => o.id !== 'github_push').map((o) => [o.id, o] as const))('%s respecte méthode, destination, permissions et format', async (name, operation) => asA(async () => {
    const executor = new IntegrationExecutor(new OAuthManager(transport, () => now), transport);
    const example = cases[name]; expect(example).toBeDefined();
    const result = await executor.execute(connectorIds.get(operation.provider)!, name, example.args);
    const request = calls.at(-1)!;
    expect(request.url.pathname).toBe(example.path); expect(request.method).toBe(example.method ?? 'GET');
    expect(request.authorization).toBe('Bearer access-private');
    expect(JSON.stringify(result)).not.toContain('access-private');
    if (name === 'drive_search') expect(request.url.searchParams.get('q')).toBe("trashed = false and name contains 'L\\'énergie'");
    if (name === 'drive_create') expect(request.body).toMatch(/Content-Type: text\/plain; charset=UTF-8/);
    if (name === 'drive_read') expect(result.untrusted_content).toContain('Texte réel');
    if (name === 'gmail_read') expect(result.untrusted_content).toBe('Message test');
    if (name === 'outlook_read') expect(result.untrusted_content).toContain('Message Outlook');
    if (name === 'gmail_send' || name === 'gmail_draft') {
      const body = JSON.parse(request.body); const raw = Buffer.from(body.raw ?? body.message.raw, 'base64url').toString();
      expect(raw).toContain('To: friend@example.com\r\n'); expect(raw).toContain(Buffer.from(message.subject).toString('base64'));
    }
    if (name === 'outlook_event_create') expect(JSON.parse(request.body).start).toEqual({ dateTime: '2026-10-21T12:00:00.000', timeZone: 'UTC' });
    if (name === 'calendar_create') expect(request.url.searchParams.get('sendUpdates')).toBe('all');
  }));
  it('rejette injection de chemin, de courriel, dates invalides et arguments supplémentaires avant le réseau', async () => asA(async () => {
    const executor = new IntegrationExecutor(new OAuthManager(transport, () => now), transport);
    for (const [provider, operation, args] of [
      ['github', 'github_issue', { repo: '../x', number: 1 }],
      ['gmail', 'gmail_send', { ...message, subject: 'hello\r\nBcc: hidden@example.com' }],
      ['google-calendar', 'calendar_create', { ...event, end: event.start }],
      ['google-drive', 'drive_search', { query: 'x', url: 'http://evil.example' }],
    ] as const) await expect(executor.execute(connectorIds.get(provider)!, operation, args)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  }));
  it.each([401, 403, 429])('remonte le refus HTTP %i sans divulguer les jetons', async (status) => asA(async () => {
    apiStatus = status;
    const executor = new IntegrationExecutor(new OAuthManager(transport, () => now), transport);
    await expect(executor.execute(connectorIds.get('github')!, 'github_repos', {})).rejects.toThrow(String(status));
    if (status === 401) expect((await getConnector(connectorIds.get('github')!))!.status).toBe('error');
  }));
  it('refuse un connecteur désactivé, une permission retirée et un compte différent', async () => asA(async () => {
    const executor = new IntegrationExecutor(new OAuthManager(transport, () => now), transport), id = connectorIds.get('github')!;
    const row = (await getConnector(id))!;
    await updateConnector(id, { enabled: false });
    await expect(executor.execute(id, 'github_repos', {})).rejects.toThrow('indisponible');
    await updateConnector(id, { enabled: true, config: { ...row.config, permissions: ['read'] } });
    await expect(executor.execute(id, 'github_comment', cases.github_comment.args)).rejects.toThrow('autorisée');
    await expect(withAccount(b, () => executor.execute(id, 'github_repos', {}))).rejects.toThrow('introuvable');
    expect(calls).toHaveLength(0);
    await updateConnector(id, { config: row.config, status: 'ok' });
  }));
});

describe('validation humaine obligatoire et routes natives', () => {
  it('ne publie rien avant approbation, exécute une fois et empêche le contournement par approval:auto', async () => asA(async () => {
    vi.stubGlobal('fetch', transport);
    const row = (await getConnector(connectorIds.get('github')!))!;
    await replaceConnectorSecrets(row.id, { ...readSecrets(row), expires_at: '0' });
    await updateConnector(row.id, { approval: 'auto' });
    const created = await createAgent({ name: 'GitHub' }), agent = (await getAgent(created.id))!;
    const conversationId = await mainConversationId(agent.id);
    const build = async () => (await buildCapabilityTools({ agent: (await getAgent(agent.id))!, conversationId, isMain: true, userTurn: true, depth: 0, tz: 'UTC' })).tools;
    const tools = await build(), tool = tools[`svc_${row.id.slice(-8)}_github_comment`]; expect(tool).toBeDefined();
    const prepare = () => tool.execute!(cases.github_comment.args as never, { toolCallId: 'comment', messages: [] } as any) as Promise<any>;
    const pending = await prepare(); expect(pending.status).toBe('pending_approval'); expect(calls).toHaveLength(0);
    expect((await getApproval(pending.approvalId))!.status).toBe('pending');
    const resolved = await resolveApproval(pending.approvalId, 'approve', { by: 'ui', notifyAgent: false });
    expect(resolved.status).toBe('executed'); expect(calls).toHaveLength(1);
    await expect(resolveApproval(pending.approvalId, 'approve', { by: 'ui', notifyAgent: false })).rejects.toThrow('déjà');
    expect(calls).toHaveLength(1);
    const refused = await prepare(); await resolveApproval(refused.approvalId, 'reject', { by: 'ui', notifyAgent: false }); expect(calls).toHaveLength(1);
    const obsolete = await prepare(); await updateConnector(row.id, { enabled: false });
    expect((await resolveApproval(obsolete.approvalId, 'approve', { by: 'ui', notifyAgent: false })).status).toBe('failed'); expect(calls).toHaveLength(1);
    await updateConnector(row.id, { enabled: true });
    const revoked = await prepare(); await updateAgent(agent.id, { permissions: { ...agent.permissions, connectors: false } });
    expect((await resolveApproval(revoked.approvalId, 'approve', { by: 'ui', notifyAgent: false })).status).toBe('failed'); expect(calls).toHaveLength(1);
    expect((await build())[`svc_${row.id.slice(-8)}_github_comment`]).toBeUndefined();
    vi.unstubAllGlobals();
  }));
  it('teste réellement l’identité du fournisseur et signale une identité divergente', async () => asA(async () => {
    vi.stubGlobal('fetch', transport);
    const id = connectorIds.get('google-drive')!, api = createApi(), row = (await getConnector(id))!;
    await replaceConnectorSecrets(id, { ...readSecrets(row), expires_at: '0' });
    const headers = { 'x-opendots-client': '1', 'content-type': 'application/json' };
    expect((await api.request(`/integrations/${id}/test`, { method: 'POST', headers, body: '{}' })).status).toBe(200);
    userId = 'different-identity';
    expect((await api.request(`/integrations/${id}/test`, { method: 'POST', headers, body: '{}' })).status).toBe(400);
    expect((await getConnector(id))!.status).toBe('error');
  }));
  it('empêche les routes génériques de modifier les droits et supprime les jetons lors de la déconnexion', async () => asA(async () => {
    const id = connectorIds.get('gmail')!, api = createApi();
    const headers = { 'x-opendots-client': '1', 'content-type': 'application/json' };
    expect((await api.request(`/connectors/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ config: { permissions: ['send'] } }) })).status).toBe(400);
    expect((await api.request(`/connectors/${id}`, { method: 'DELETE', headers })).status).toBe(400);
    expect((await withAccount(b, () => api.request(`/integrations/${id}/disconnect`, { method: 'POST', headers, body: '{}' }))).status).toBe(404);
    expect((await api.request(`/integrations/${id}/disconnect`, { method: 'POST', headers, body: '{}' })).status).toBe(200);
    expect(await getConnector(id)).toBeNull(); expect(calls).toHaveLength(0);
  }));
});

describe('GitHub : dépôts, pull requests et git push', () => {
  it('demande repo et workflow pour la permission code et expose les opérations d’écriture', () => {
    expect(selectedScopes('github', ['code'])).toEqual(expect.arrayContaining(['read:user', 'repo', 'workflow']));
    const ops = availableOperations({ provider: 'github', account: {} as never, permissions: ['code'], grantedScopes: ['repo', 'workflow'] } as never).map((o) => o.id);
    expect(ops).toEqual(expect.arrayContaining(['github_repos', 'github_repo_create', 'github_pr_create', 'github_branch_create', 'github_pr_merge', 'github_push']));
    expect(OPERATIONS.filter((o) => o.permission === 'code').every((o) => o.write)).toBe(true);
    expect(availableOperations({ provider: 'github', permissions: ['read', 'write'] } as never).some((o) => o.permission === 'code')).toBe(false);
    // repo (dépôts privés) couvre déjà ces opérations : pas besoin de reconnecter.
    expect(availableOperations({ provider: 'github', permissions: ['read', 'private'] } as never).map((o) => o.id)).toEqual(expect.arrayContaining(['github_repo_create', 'github_pr_create', 'github_push']));
  });
  it('neutralise hooks, assistants et proxy du dépôt sans jamais placer le jeton dans les arguments', () => {
    const args = gitPushArgs({ path: '.', repo: 'owner/project', branch: 'main' });
    expect(args.join(' ')).not.toContain('access-private');
    expect(args).toEqual(expect.arrayContaining(['core.hooksPath=/dev/null', 'credential.helper=', 'http.sslVerify=true', 'protocol.allow=never', '--no-verify']));
    expect(args.indexOf('credential.helper=')).toBeLessThan(args.findIndex((v) => v.startsWith('credential.https://github.com.helper=')));
    expect(args.slice(-2)).toEqual(['https://github.com/owner/project.git', 'refs/heads/main:refs/heads/main']);
  });
  it('pousse avec le jeton du compte propriétaire, exige un compagnon et valide chemin et branche', async () => {
    const pushes: any[] = [];
    const executor = new IntegrationExecutor(new OAuthManager(transport, () => now), transport, async (r) => { pushes.push(r); return { ok: true, stdout: `pushed ${r.branch}` }; });
    const id = connectorIds.get('github')!, args = { repo: 'owner/project', path: 'projet', branch: 'feature/x' };
    await expect(asA(() => executor.execute(id, 'github_push', args))).rejects.toThrow('compagnon');
    const result = await asA(() => executor.execute(id, 'github_push', args, { agentId: 'ag_test' }));
    expect(pushes).toHaveLength(1); expect(pushes[0]).toMatchObject({ agentId: 'ag_test', repo: 'owner/project', path: 'projet', branch: 'feature/x', token: 'access-private' });
    expect(JSON.stringify(result)).not.toContain('access-private');
    for (const bad of [{ ...args, path: '../autre' }, { ...args, path: '/etc' }, { ...args, branch: '--force' }, { ...args, branch: 'a..b' }, { ...args, repo: 'owner/../x' }, { ...args, force: true }]) await expect(asA(() => executor.execute(id, 'github_push', bad, { agentId: 'ag_test' }))).rejects.toThrow();
    await expect(withAccount(b, () => executor.execute(id, 'github_push', args, { agentId: 'ag_test' }))).rejects.toThrow('introuvable');
    expect(pushes).toHaveLength(1);
  });
});
