/** Real account/controller startup and Docker restart, no paid model calls. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'opendots-autostart-smoke-'));
process.env.OPENDOTS_DATA_DIR = dir;
const { authStore, closeAuthStore, registerUser } = await import('../src/auth/store.ts');
const { withAccount } = await import('../src/auth/context.ts');
const { openDatabase, closeAllDatabases } = await import('../src/db/client.ts');
const { createAgent, updateAgent } = await import('../src/agents/repo.ts');
const { setSetting } = await import('../src/settings.ts');
const { withDesktopAgent } = await import('../src/computer/session.ts');
const { desktopStatus, desktopExec, removeDesktop } = await import('../src/computer/desktop.ts');
const { computerName, computerState } = await import('../src/computer/shell.ts');
await authStore(true);
const a = await registerUser('autostart-a@example.com', 'isolated startup password');
const b = await registerUser('autostart-b@example.com', 'isolated startup password');
for (const account of [a,b]) await withAccount(account, () => openDatabase({ memory: true }));
const botA = await withAccount(a, () => createAgent({ name: 'First', permissions: { computer: true } }));
const botC = await withAccount(a, () => createAgent({ name: 'Second', permissions: { computer: true } }));
const botB = await withAccount(b, () => createAgent({ name: 'Other account', permissions: { computer: true } }));
const asA = <T>(fn: () => T) => withAccount(a, () => withDesktopAgent(botA.id, fn));
const asC = <T>(fn: () => T) => withAccount(a, () => withDesktopAgent(botC.id, fn));
const asB = <T>(fn: () => T) => withAccount(b, () => withDesktopAgent(botB.id, fn));
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let i=0; i<80; i++) { last=await read(); if(check(last)) return last; await new Promise(r=>setTimeout(r,200)); }
  throw new Error(`Desktop startup timed out: ${JSON.stringify(last)}`);
}
const { registerComputerAutostart, stopComputerAutostart } = await import('../src/computer/autostart.ts');
process.env.OPENDOTS_COMPUTER_IDLE_SECONDS = '300';
try {
  const disabled = await withAccount(a, () => createAgent({ name: 'No desktop', permissions: { computer: false } }));
  await withAccount(a, () => setSetting(`desktop.bot.${botC.id}`, { enabled: false }));
  await registerComputerAutostart(a);
  assert.equal((await asA(desktopStatus)).running, true);
  assert.equal((await asC(desktopStatus)).running, false);
  assert.equal(await asB(computerState), null);
  const name = await asA(computerName);
  const uid = (await asA(() => desktopExec(['id','-u']))).toString().trim();
  await asA(() => desktopExec(['sh','-c','printf autostart-persistent > "$HOME/autostart-note.txt"']));
  const absent = await run('docker',['exec',name,'sh','-c',`id ${ (await import('../src/computer/shell.ts')).linuxUser(disabled.id) } >/dev/null 2>&1 && echo present || echo absent`]);
  assert.equal(absent.stdout.trim(),'absent');
  const ready = (context: typeof asA) => until(() => context(desktopStatus), value => value.running && !value.restartRequired);
  await withAccount(a, () => setSetting(`desktop.bot.${botC.id}`, { enabled: true }));
  await run('docker',['restart','--time','2',name]);
  // Poll status ONLY: no start/screenshot/keyboard/tool call can start a session.
  await ready(asA); await ready(asC);
  assert.equal((await asA(() => desktopExec(['id','-u']))).toString().trim(),uid);
  assert.equal((await asA(() => desktopExec(['sh','-c','cat "$HOME/autostart-note.txt"']))).toString(),'autostart-persistent');
  for(const context of [asA,asC]) {
    assert.equal((await context(() => desktopExec(['sh','-c','pgrep -u "$(id -u)" -x chromium || true']))).toString().trim(),'');
    assert.match((await context(() => desktopExec(['xdotool','getdisplaygeometry']))).toString(), /1280 800/);
  }
  console.log('PASS autostart : démarrage initial des seuls bureaux autorisés, restart Docker lance les deux écrans sans appel start, UID et fichiers persistants, aucun Chromium.');
  await asC(removeDesktop);
  await withAccount(a, () => updateAgent(botA.id, { permissions: { ...botA.permissions, computer: false } }));
  await run('docker',['restart','--time','2',name]);
  // Wait for an explicit reconciliation too: neither disabled bot may relaunch.
  await registerComputerAutostart(a);
  assert.equal((await asA(desktopStatus)).running,false);
  assert.equal((await asC(desktopStatus)).running,false);
  assert.equal((await run('docker',['exec',name,'sh','-c','pgrep -x Xvfb || true'])).stdout.trim(),'');
  await withAccount(a, () => updateAgent(botA.id, { permissions: { ...botA.permissions, computer: true } }));
  await stopComputerAutostart();
  await run('docker',['stop','--time','2',name]);
  await registerComputerAutostart(a);
  await ready(asA); assert.equal((await asC(desktopStatus)).running,false);
  await registerComputerAutostart(b); await ready(asB);
  assert.notEqual((await asA(computerState))!.id,(await asB(computerState))!.id);
  await Promise.all([registerComputerAutostart(a),registerComputerAutostart(a)]);
  assert.equal((await asA(() => desktopExec(['sh','-c','pgrep -u "$(id -u)" -x Xvfb | wc -l']))).toString().trim(),'1');
  console.log('PASS autorisation retirée et arrêt explicite respectés, redémarrage OpenDots rallume le conteneur et les bureaux éligibles, comptes isolés et démarrage idempotent.');
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await stopComputerAutostart();
  for (const account of [a,b]) await withAccount(account, () => run('docker', ['rm','-f',computerName()])).catch(() => {});
  await closeAllDatabases(); await closeAuthStore(); await rm(dir,{ recursive:true, force:true }).catch(() => {});
}
