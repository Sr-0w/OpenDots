import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/app.ts';
import { authStore, closeAuthStore, sessionAccount } from '../src/auth/store.ts';
import { currentAccount, withAccount, type AccountContext } from '../src/auth/context.ts';
import { closeAllDatabases, openDatabase, db, schema } from '../src/db/client.ts';
import { createAgent, mainConversationId } from '../src/agents/repo.ts';
import { createConnector } from '../src/connectors/repo.ts';
import { getOpenRouterKey, setOpenRouterKey } from '../src/settings.ts';
import { decryptSecret, encryptSecret } from '../src/secrets.ts';
import { ActiveStream, beginStream, finishStream, getActiveStream } from '../src/agents/streams.ts';
import { publish, subscribe } from '../src/bus.ts';
import { enqueue, registerJobHandler, startQueue, stopQueue } from '../src/jobs/queue.ts';
import { resolveBackend } from '../src/computer/shell.ts';

const app = createApplication(async () => { await openDatabase({ memory: true }); });
const request = (path: string, method = 'GET', body?: unknown, cookie?: string, origin?: string) => app.request(`https://app.example/api${path}`, { method, headers: { 'content-type': 'application/json', 'x-opendots-client': '1', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
let a: AccountContext, b: AccountContext, cookieA: string, cookieB: string;
beforeAll(async () => { await authStore(true); });
afterAll(async () => { await closeAllDatabases(); await closeAuthStore(); });
describe('authentification et séparation des comptes', () => {
  it('refuse toutes les routes privées sans session, y compris les événements et clés', async () => {
    for (const path of ['/bootstrap', '/agents', '/connectors', '/settings', '/events', '/account/profile', '/account/avatar']) expect((await request(path)).status).toBe(401);
  });
  it('crée des comptes sans leur donner les droits administrateur et émet des cookies sûrs', async () => {
    for (const [email, assign] of [['alice@example.com', (v: string) => cookieA = v], ['bob@example.com', (v: string) => cookieB = v]] as const) {
      const res = await request('/auth/register', 'POST', { email, password: 'correct horse battery staple' });
      expect(res.status).toBe(200);
      const cookie = res.headers.get('set-cookie')!;
      expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Lax');
      assign(cookie.split(';')[0]);
      expect((await res.json()).account.role).toBe('user');
    }
    a = (await sessionAccount(cookieA.split('=')[1]))!;
    b = (await sessionAccount(cookieB.split('=')[1]))!;
    const sessions = await (await authStore()).query<{hash:string}>('SELECT hash FROM sessions');
    expect(sessions.rows.every((s) => !cookieA.includes(s.hash) && !cookieB.includes(s.hash))).toBe(true);
  });
  it('ne renvoie ni mot de passe ni dossier serveur dans le profil', async () => {
    expect(await (await request('/auth/me', 'GET', undefined, cookieA)).json()).toEqual({ account: { id: a.id, email: a.email, role: 'user' }, registrationOpen: true });
  });
  it('refuse les mutations de session venant d’un autre site', async () => {
    expect((await request('/auth/logout', 'POST', {}, cookieA, 'https://evil.example')).status).toBe(403);
    expect((await app.request('http://public.example/api/auth/login', { method: 'POST', headers: { 'x-opendots-client': '1', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await app.request('https://app.example/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
  });
  it('isole les compagnons, conversations et connecteurs même en connaissant leurs identifiants', async () => {
    await request('/bootstrap', 'GET', undefined, cookieA); await request('/bootstrap', 'GET', undefined, cookieB);
    const agent = await withAccount(a, () => createAgent({ name: 'Ari privé' }));
    const connector = await withAccount(a, () => createConnector({ name: 'Mail privé', kind: 'mail', config: {} }));
    expect((await request(`/agents/${agent.id}`, 'GET', undefined, cookieA)).status).toBe(200);
    for (const path of [`/agents/${agent.id}`, `/agents/${agent.id}/stream`]) expect((await request(path, 'GET', undefined, cookieB)).status).toBe(404);
    expect((await request(`/agents/${agent.id}/stop`, 'POST', {}, cookieB)).status).toBe(404);
    expect((await request(`/connectors/${connector.id}`, 'DELETE', {}, cookieB)).status).toBe(404);
    expect(await (await request('/agents', 'GET', undefined, cookieB)).json()).toEqual([]);
    expect(await (await request('/connectors', 'GET', undefined, cookieB)).json()).toEqual([]);
  });
  it('conserve une clé OpenRouter personnelle et ne transmet pas celle d’un autre compte', async () => {
    await withAccount(a, () => setOpenRouterKey('alice-personal-key'));
    expect(await withAccount(a, getOpenRouterKey)).toBe('alice-personal-key');
    const previousGlobalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'deployment-key-must-not-be-shared';
    try {
      expect(await withAccount(a, getOpenRouterKey)).toBe('alice-personal-key');
      expect(await withAccount(b, getOpenRouterKey)).toBeNull();
    } finally { if (previousGlobalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousGlobalKey; }
    const settings = await (await request('/settings', 'GET', undefined, cookieA)).text();
    expect(settings).not.toContain('alice-personal-key');
    const cipher = withAccount(a, () => encryptSecret('private refresh token'));
    expect(withAccount(a, () => decryptSecret(cipher))).toBe('private refresh token');
    expect(() => withAccount(b, () => decryptSecret(cipher))).toThrow();
  });
  it('sépare les événements SSE par compte et conserve le contexte asynchrone', async () => {
    const got: string[] = [];
    const off = withAccount(a, () => subscribe((event) => got.push(event.type)));
    withAccount(b, () => publish({ type: 'settings.changed' }));
    expect(got).toEqual([]);
    await withAccount(a, async () => { await Promise.resolve(); expect(currentAccount()?.id).toBe(a.id); publish({ type: 'settings.changed' }); });
    expect(got).toEqual(['settings.changed']); off();
  });
  it('sépare aussi les flux de modèle quand deux bases ont le même identifiant de conversation', () => {
    const first = withAccount(a, () => new ActiveStream('same-conversation'));
    const second = withAccount(b, () => new ActiveStream('same-conversation'));
    withAccount(a, () => beginStream(first)); withAccount(b, () => beginStream(second));
    expect(withAccount(a, () => getActiveStream('same-conversation'))).toBe(first);
    expect(withAccount(b, () => getActiveStream('same-conversation'))).toBe(second);
    finishStream(first); finishStream(second);
  });
  it('interdit les sorties vers le shell hôte et les serveurs MCP avancés aux utilisateurs', async () => {
    expect(await withAccount(b, () => resolveBackend({ mode: 'host', approval: 'auto', image: 'debian:stable-slim', network: true, sudo: false }))).toBeNull();
    await expect(withAccount(b, () => createConnector({ name: 'Unsafe', kind: 'mcp', config: { transport: 'stdio', command: 'sh' } }))).rejects.toThrow('administrateur');
  });
  it('exécute des tâches simultanées dans le compte qui les a créées', async () => {
    const seen: string[] = [];
    registerJobHandler('test.account-context', async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(currentAccount()?.id).toBe(payload.owner);
      seen.push(currentAccount()!.id);
    });
    try {
      for (const actor of [a, b]) await withAccount(actor, async () => {
        await enqueue('test.account-context', { owner: actor.id }, { dedupeKey: 'same-key-in-two-accounts' });
        await startQueue();
      });
      await expect.poll(() => seen.length).toBe(2);
      expect(seen.sort()).toEqual([a.id, b.id].sort());
      for (const actor of [a, b]) await expect.poll(() => withAccount(actor, async () => (await db().select().from(schema.jobs))[0]?.status)).toBe('done');
    } finally { for (const actor of [a, b]) await withAccount(actor, stopQueue); }
  });
  it('refuse un mot de passe incorrect et invalide immédiatement la session à la déconnexion', async () => {
    expect((await request('/auth/login', 'POST', { email: a.email, password: 'incorrect password' })).status).toBe(400);
    const agent = await withAccount(a, () => createAgent({ name: 'Stream' }));
    const active = await withAccount(a, async () => new ActiveStream(await mainConversationId(agent.id)));
    withAccount(a, () => beginStream(active));
    active.push({ type: 'start', messageId: 'test' });
    const modelResponse = await request(`/agents/${agent.id}/stream`, 'GET', undefined, cookieA);
    const modelReader = modelResponse.body!.getReader();
    expect(new TextDecoder().decode((await modelReader.read()).value)).toContain('start');
    const stream = await request('/events', 'GET', undefined, cookieA);
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('hello');
    expect((await request('/auth/logout', 'POST', {}, cookieA)).status).toBe(200);
    expect((await reader.read()).done).toBe(true);
    expect((await modelReader.read()).done).toBe(true);
    expect(active.done).toBe(false);
    finishStream(active);
    expect((await request('/bootstrap', 'GET', undefined, cookieA)).status).toBe(401);
    const login = await request('/auth/login', 'POST', { email: a.email, password: 'correct horse battery staple' });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).not.toContain(cookieA);
  });
});
