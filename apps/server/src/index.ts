import { reportUnhandledRejection } from './agents/interruption.ts';
import { attachDesktopWebSocket } from './computer/websocket.ts';
import { serve } from '@hono/node-server';
import { config } from './config.ts';
import { setupNetwork } from './net.ts';
import { closeAllDatabases } from './db/client.ts';
import { registerLifeHandlers } from './life/engine.ts';
import { closeAllMcpClients } from './connectors/mcp.ts';
import { ensureLocalSearch } from './tools/local-search.ts';
import { createApplication } from './app.ts';
import { authStore, closeAuthStore, listAccounts } from './auth/store.ts';
import { activateAccount, stopAccountRuntimes } from './auth/runtime.ts';

process.on('unhandledRejection', reportUnhandledRejection);
setupNetwork();
registerLifeHandlers();
await authStore();
for (const account of await listAccounts()) await activateAccount(account);
void ensureLocalSearch().then(() => console.log('SearXNG local est prêt.')).catch((error: Error) => console.warn(error.message));
const app = createApplication();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`OpenDots est prêt sur http://${info.address}:${info.port}`);
  console.log('Les API privées nécessitent une session utilisateur.');
});
const closeDesktopSockets = attachDesktopWebSocket(server as import("node:http").Server);
async function shutdown() {
  closeDesktopSockets();
  console.log('Arrêt d’OpenDots…');
  server.close();
  await stopAccountRuntimes();
  await closeAllMcpClients();
  await closeAllDatabases();
  await closeAuthStore();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
