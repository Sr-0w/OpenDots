import { afterAll, expect, it } from 'vitest';
import { authStore, authenticate, closeAuthStore, createSession, registerUser, sessionAccount } from '../src/auth/store.ts';
import { withAccount } from '../src/auth/context.ts';
import { closeAllDatabases, openDatabase } from '../src/db/client.ts';
import { createAgent, listAgents } from '../src/agents/repo.ts';
import { getOpenRouterKey, setOpenRouterKey } from '../src/settings.ts';
import { createConnector, listConnectors, readSecrets } from '../src/connectors/repo.ts';

afterAll(async () => { await closeAllDatabases(); await closeAuthStore(); });
it('conserve comptes, sessions, données privées et secrets chiffrés après réouverture réelle sur disque', async () => {
  await authStore();
  const account = await registerUser(`persistent-${Date.now()}@example.com`, 'persistent password for test');
  const token = await createSession(account.id);
  await withAccount(account, async () => {
    await openDatabase();
    await createAgent({ name: 'Persistant' });
    await setOpenRouterKey('persistent-personal-key');
    await createConnector({ name: 'Gmail', kind: 'integration', config: { provider: 'gmail', account: { id: 'provider-id', label: 'Private' }, permissions: ['read'], grantedScopes: [] }, secrets: { access_token: 'persistent-private-token' } });
  });
  await closeAllDatabases(); await closeAuthStore();
  await authStore();
  const restored = await authenticate(account.email, 'persistent password for test');
  expect(restored.id).toBe(account.id); expect((await sessionAccount(token))?.id).toBe(account.id);
  await withAccount(restored, async () => {
    await openDatabase();
    expect((await listAgents()).map((a) => a.name)).toEqual(['Persistant']);
    expect(await getOpenRouterKey()).toBe('persistent-personal-key');
    const row = (await listConnectors())[0];
    expect(row.secret).not.toContain('persistent-private-token');
    expect(readSecrets(row).access_token).toBe('persistent-private-token');
  });
});
