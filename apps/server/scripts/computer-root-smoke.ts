/** Install a real .deb as root and prove peer PCs remain inaccessible. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const run = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'opendots-root-'));
process.env.OPENDOTS_DATA_DIR = dir;
const { authStore, registerUser, closeAuthStore } = await import('../src/auth/store.ts');
const { withAccount } = await import('../src/auth/context.ts');
const { openDatabase, closeAllDatabases } = await import('../src/db/client.ts');
const { createAgent } = await import('../src/agents/repo.ts');
const { getShellSettings } = await import('../src/settings.ts');
const { execShell, computerName, accountComputerName } = await import('../src/computer/shell.ts');
const { withDesktopAgent } = await import('../src/computer/session.ts');
await authStore(true);
const account = await registerUser('root@example.com', 'root smoke test password');
await withAccount(account, () => openDatabase({ memory: true }));
const a = await withAccount(account, () => createAgent({ name: 'Root A' }));
const b = await withAccount(account, () => createAgent({ name: 'Root B' }));
const as = <T>(bot: typeof a, fn: () => T) => withAccount(account, () => withDesktopAgent(bot.id, fn));
const shell = async (bot: typeof a, command: string) => {
  const result = await as(bot, () => execShell(bot.id, command));
  assert.equal(result.exitCode, 0, JSON.stringify(result)); return result.stdout;
};
try {
  const legacy = await withAccount(account, accountComputerName);
  const settings = await withAccount(account, getShellSettings);
  await run('docker', ['run','-d','--name',legacy,settings.image,'sleep','infinity']);
  assert((await withAccount(account, getShellSettings)).sudo);
  const installed = await shell(a, `set -eu
sudo -n id -u
mkdir -p /tmp/admin-fixture/DEBIAN /tmp/admin-fixture/usr/local/bin
printf 'Package: opendots-admin-fixture\\nVersion: 1.0\\nArchitecture: all\\nMaintainer: OpenDots <fixture@example.test>\\nDescription: Real administrator installation regression\\n' > /tmp/admin-fixture/DEBIAN/control
printf '#!/bin/sh\\nprintf "installed-as-root\\\\n"\\n' > /tmp/admin-fixture/usr/local/bin/opendots-admin-fixture
chmod 755 /tmp/admin-fixture/usr/local/bin/opendots-admin-fixture
dpkg-deb --build /tmp/admin-fixture /tmp/admin-fixture.deb
sudo -n dpkg -i /tmp/admin-fixture.deb
opendots-admin-fixture
sudo -n sh -c 'printf only-a > /root/private-a; printf private-system > /usr/local/share/private-a'
printf shared-ok > /workspaces/shared/root-fixture
printf home-persisted > home-note`);
  assert.match(installed, /installed-as-root/);
  assert.equal((await run('docker', ['inspect','--format','{{.State.Running}}',legacy])).stdout.trim(), 'false');
  const peer = await shell(b, `set -eu
[ "$(sudo -n id -u)" = 0 ]
sudo -n test ! -e /root/private-a
sudo -n test ! -e /usr/local/share/private-a
sudo -n test ! -e /workspaces/${a.id}
! command -v opendots-admin-fixture
cat /workspaces/shared/root-fixture
printf peer-isolated`);
  assert.match(peer, /shared-ok/); assert.match(peer, /peer-isolated/);
  const names = await Promise.all([a,b].map(bot => as(bot, computerName)));
  assert.notEqual(names[0], names[1]);
  const peerId = (await run('docker', ['inspect', '--format', '{{.Id}}', names[1]])).stdout.trim();
  await run('docker', ['restart', '--time', '2', names[0]]);
  const retained = await shell(a, 'opendots-admin-fixture; cat home-note; sudo -n cat /root/private-a');
  assert.match(retained, /installed-as-root/); assert.match(retained, /home-persisted/); assert.match(retained, /only-a/);
  assert.equal((await run('docker', ['inspect', '--format', '{{.Id}}', names[1]])).stdout.trim(), peerId);
  for (let i=0;i<names.length;i++) {
    const inspection = JSON.parse((await run('docker', ['inspect', names[i]])).stdout)[0];
    assert.equal(inspection.HostConfig.ReadonlyRootfs, false);
    assert(!inspection.Mounts.some((m: any) => m.Destination === '/workspaces' || /docker.sock/.test(m.Destination)));
    assert(!inspection.HostConfig.Privileged);
    assert(inspection.Mounts.some((m: any) => m.Destination === `/workspaces/${[a,b][i].id}` && m.RW));
  }
  console.log('PASS real root .deb installation, writable system, restart persistence, independent PCs and root-level peer isolation');
} finally {
  await withAccount(account, () => run('docker', ['rm','-f',accountComputerName()])).catch(() => {});
  for (const bot of [a,b]) await as(bot, () => run('docker', ['rm','-f',computerName()])).catch(() => {});
  await closeAllDatabases(); await closeAuthStore(); await rm(dir, { recursive:true, force:true }).catch(() => {});
}
