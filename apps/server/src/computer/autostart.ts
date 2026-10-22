import { spawn, type ChildProcess } from 'node:child_process';
import { withAccount, type AccountContext } from '../auth/context.ts';
import { listAgentRows } from '../agents/repo.ts';
import { getSetting, getShellSettings } from '../settings.ts';
import { computerName, dockerAvailable } from './shell.ts';
import { startDesktop } from './desktop.ts';
import { withDesktopAgent } from './session.ts';

const accounts = new Map<string, AccountContext>();
const restoring = new Map<string, Promise<void>>();
let watcher: ChildProcess | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;

/** The controller re-reads permissions, never copies credentials into Docker
 * labels or delegates access decisions to a bot's writable home directory. */
export function restoreAccountDesktops(account: AccountContext): Promise<void> {
  if (restoring.has(account.id)) return restoring.get(account.id)!;
  const pending = withAccount(account, async () => {
    const settings = await getShellSettings();
    if (settings.mode === 'off' || settings.mode === 'host' || !settings.network) return;
    const agents = (await listAgentRows()).filter(agent => !agent.archived && agent.permissions.computer);
    if (!agents.length || !await dockerAvailable()) return;
    for (const agent of agents) {
      if ((await getSetting(`desktop.bot.${agent.id}`))?.enabled === false) continue;
      try { await withDesktopAgent(agent.id, startDesktop); }
      catch { console.warn(`[computer autostart] Bureau indisponible pour ${agent.id} ; les autres bureaux continuent leur démarrage.`); }
    }
  }).finally(() => { if (restoring.get(account.id) === pending) restoring.delete(account.id); });
  restoring.set(account.id, pending);
  return pending;
}

function restore(account: AccountContext) {
  void restoreAccountDesktops(account).catch(() => console.warn('[computer autostart] Restauration du compte indisponible.'));
}

function watch() {
  if (watcher || !accounts.size) return;
  const child = spawn('docker', ['events', '--filter', 'type=container', '--filter', 'event=start', '--format', '{{json .}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
  watcher = child;
  let buffer = '';
  child.stdout!.on('data', (data: Buffer) => {
    buffer += data.toString();
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const event = JSON.parse(line);
        if (event.Type !== 'container' || (event.Action ?? event.status) !== 'start') continue;
        const account = accounts.get(event.Actor?.Attributes?.name);
        if (account) restore(account);
      } catch { /* A malformed event cannot stop other account restores. */ }
    }
    if (buffer.length > 64_000) buffer = '';
  });
  child.on('error', () => {}); // close schedules recovery, including a missing daemon.
  child.on('close', () => {
    if (watcher !== child) return;
    watcher = undefined;
    if (!accounts.size) return;
    retry = setTimeout(() => {
      retry = undefined; watch();
      // Reconcile missed starts after a daemon/socket interruption.
      for (const account of accounts.values()) restore(account);
    }, 5000);
    retry.unref();
  });
}

/** Background startup does not delay login or HTTP readiness. */
export function registerComputerAutostart(account: AccountContext): Promise<void> {
  accounts.set(withAccount(account, computerName), account);
  watch();
  return restoreAccountDesktops(account);
}

export async function stopComputerAutostart() {
  accounts.clear(); clearTimeout(retry); retry = undefined;
  const child = watcher; watcher = undefined; child?.kill();
  await Promise.allSettled([...restoring.values()]);
}
