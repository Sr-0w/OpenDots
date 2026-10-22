import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createApplication } from '../src/app.ts';
import { ensureLocalSearch } from '../src/tools/local-search.ts';

afterEach(() => vi.unstubAllEnvs());
it('exposes only a minimal health response without authentication', async () => {
  const response = await createApplication().request('/healthz');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

it('uses the healthy deployment-owned SearXNG and fails closed when it stops', async () => {
  let ready = true;
  const server = createServer((_req, res) => { res.statusCode = ready ? 200 : 503; res.end(ready ? 'OK' : 'unavailable'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;
    vi.stubEnv('OPENDOTS_SEARXNG_URL', origin);
    expect(await ensureLocalSearch()).toBe(origin);
    ready = false;
    await expect(ensureLocalSearch()).rejects.toThrow('docker compose');
    vi.stubEnv('OPENDOTS_SEARXNG_URL', 'http://user:password@localhost');
    await expect(ensureLocalSearch()).rejects.toThrow('invalide');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
