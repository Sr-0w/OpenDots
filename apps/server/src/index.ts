import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config.ts';
import { setupNetwork } from './net.ts';
import { closeDatabase, openDatabase } from './db/client.ts';
import { createApi } from './api/routes.ts';
import { startQueue, stopQueue } from './jobs/queue.ts';
import { registerLifeHandlers, startScheduler, stopScheduler } from './life/engine.ts';
import { db, schema } from './db/client.ts';
import { ne } from 'drizzle-orm';
import { startMailPoller, stopMailPoller } from './mail/service.ts';
import { closeAllMcpClients } from './connectors/mcp.ts';
import { ensureLocalSearch } from './tools/local-search.ts';
import { getSearchSettings } from './settings.ts';

setupNetwork();
await openDatabase();
if ((await getSearchSettings()).provider === 'auto') {
  // Warm up without blocking the UI; the first search awaits the same startup.
  void ensureLocalSearch().then(() => console.log('SearXNG local est prêt.')).catch((error: Error) => console.warn(error.message));
}

// Au démarrage, aucun tour n'est en cours : on remet les états à jour.
await db().update(schema.agents).set({ state: 'available', stateDetail: null }).where(ne(schema.agents.state, 'available'));

registerLifeHandlers();
await startQueue();
startScheduler();
startMailPoller();

const app = new Hono();
app.route('/api', createApi());

if (existsSync(config.webDist)) {
  app.use('/*', serveStatic({ root: config.webDist.replace(process.cwd() + '/', './') }));
  app.get('*', serveStatic({ path: `${config.webDist}/index.html`.replace(process.cwd() + '/', './') }));
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`OpenDots est prêt sur http://${info.address}:${info.port}`);
  console.log(`Données : ${config.dataDir}${config.databaseUrl ? ' (PostgreSQL externe)' : ' (PostgreSQL embarqué)'}`);
});

async function shutdown() {
  console.log('Arrêt d’OpenDots…');
  stopScheduler();
  stopMailPoller();
  await closeAllMcpClients();
  await stopQueue();
  server.close();
  await closeDatabase();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
