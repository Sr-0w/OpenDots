import { registerComputerAutostart, stopComputerAutostart } from '../computer/autostart.ts';
import { ne } from 'drizzle-orm';
import { db, openDatabase, schema } from '../db/client.ts';
import { startQueue, stopQueue } from '../jobs/queue.ts';
import { startScheduler, stopScheduler } from '../life/engine.ts';
import { startMailPoller, stopMailPoller } from '../mail/service.ts';
import { withAccount, type AccountContext } from './context.ts';

const active = new Map<string, { account: AccountContext; ready: Promise<void> }>();
export async function activateAccount(account: AccountContext) {
  const entry = active.get(account.id);
  if (entry) return entry.ready;
  const ready = withAccount(account, async () => {
    await openDatabase();
    await db().update(schema.agents).set({ state: 'available', stateDetail: null }).where(ne(schema.agents.state, 'available'));
    await startQueue(); startScheduler(); startMailPoller();
    void registerComputerAutostart(account).catch(() => console.warn('[computer autostart] Démarrage des bureaux indisponible.'));
  });
  active.set(account.id, { account, ready });
  try { await ready; } catch (error) { active.delete(account.id); throw error; }
}
export async function stopAccountRuntimes() {
  await stopComputerAutostart();
  await Promise.all([...active.values()].map(({ account }) => withAccount(account, async () => {
    stopScheduler(); stopMailPoller(); await stopQueue();
  })));
  active.clear();
}
