import { execFile, spawn } from 'node:child_process';
import { readFile, stat, access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase, closeDatabase } from '../src/db/client.ts';
import { createAgent } from '../src/agents/repo.ts';
import { setSetting, BUILTIN_COMPUTER_IMAGE } from '../src/settings.ts';
import { execShell, companionGitHead, computerStatus, dockerAvailable } from '../src/computer/shell.ts';
import { brokerEnvironment, gitPushArgs, withApprovedSnapshot } from '../src/computer/git-broker.ts';
import { createConnector } from '../src/connectors/repo.ts';
import { IntegrationExecutor } from '../src/integrations/providers.ts';
import { config } from '../src/config.ts';

const exec = promisify(execFile);
beforeAll(() => openDatabase({ memory: true }));
afterAll(() => closeDatabase());

it('imports only the approved commit, drops hostile source configuration, isolates credentials and rejects branch drift', async () => {
  expect(await dockerAvailable(), 'Docker is required for this security regression test').toBe(true);
  await setSetting('shell.config', { mode: 'docker', approval: 'ask', image: BUILTIN_COMPUTER_IMAGE, network: true, sudo: false });
  const agent = await createAgent({ name: 'Snapshot' });
  const init = await execShell(agent.id, `mkdir project && cd project && git init -q -b main && git config user.email fixture@example.com && git config user.name Fixture && echo approved > file.txt && git add file.txt && git commit -qm approved
git config http.https://github.com/.sslVerify false
git config http.https://github.com/.proxy http://127.0.0.1:9
git config credential.helper '!echo SOURCE_HELPER_MUST_NOT_RUN >&2'
git config url.https://attacker.invalid/.insteadOf https://github.com/
mkdir -p .git/hooks; printf '#!/bin/sh\necho SOURCE_HOOK_MUST_NOT_RUN >&2\nexit 99\n' > .git/hooks/pre-push; chmod +x .git/hooks/pre-push`);
  expect(init.exitCode, init.stderr).toBe(0);
  const request = { agentId: agent.id, path: 'project', branch: 'main', repo: 'owner/project', expectedSha: '' };
  request.expectedSha = await companionGitHead(request);
  const connector = await createConnector({ name: 'GitHub fixture', kind: 'integration', config: { provider: 'github', permissions: ['code'] } });
  const prepared = await new IntegrationExecutor().prepare(connector.id, 'github_push', { repo: request.repo, path: request.path, branch: request.branch }, { agentId: agent.id });
  expect(prepared.expectedSha).toBe(request.expectedSha);
  let snapshotPath = '';
  await withApprovedSnapshot(request, async (cwd, env) => {
    snapshotPath = cwd;
    const run = (args: string[]) => exec('/usr/bin/git', args, { cwd, env });
    expect((await stat(cwd)).isDirectory()).toBe(true);
    expect((await readFile(`${cwd}/config`, 'utf8'))).not.toMatch(/proxy|credential|sslVerify|include|insteadOf|SOURCE_/);
    expect((await run(['show', `${request.expectedSha}:file.txt`])).stdout.trim()).toBe('approved');
    const args = gitPushArgs(request);
    const overrides = args.slice(0, args.indexOf('push'));
    expect((await run([...overrides, 'config', '--get-urlmatch', 'http.sslVerify', 'https://github.com/owner/project.git'])).stdout.trim()).toBe('true');
    expect((await run([...overrides, 'config', '--get-urlmatch', 'http.followRedirects', 'https://github.com/owner/project.git'])).stdout.trim()).toBe('false');
    const credentials = await new Promise<string>((resolve, reject) => {
      const child = execFile('/usr/bin/git', [...overrides, 'credential', 'fill'], { cwd, env: { ...env, OPENDOTS_GIT_TOKEN: 'broker-test-only' } }, (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin!.end('protocol=https\nhost=github.com\n\n');
    });
    expect(credentials).toContain('username=x-access-token');
    expect(credentials).toContain('password=broker-test-only');

    // Exercise real Git push/object transfer and the pre-push hook boundary locally.
    const remote = `${cwd}/../destination.git`;
    await run(['init', '--bare', '--template=', remote]);
    const localArgs = args.map((a) => a === 'https://github.com/owner/project.git' ? remote : a);
    await run(['-c', 'protocol.file.allow=always', ...localArgs.slice(0, localArgs.indexOf('push')), '-c', 'protocol.file.allow=always', ...localArgs.slice(localArgs.indexOf('push'))]);
    expect((await exec('/usr/bin/git', ['-C', remote, 'rev-parse', 'refs/heads/main'], { env })).stdout.trim()).toBe(request.expectedSha);

    // A real source-UID process attempts the original /proc scan while the
    // broker has a credentialed process. Only the synthetic marker is searched.
    const status = await computerStatus();
    const who = await execShell(agent.id, 'whoami');
    const child = spawn('/usr/bin/git', ['-c', 'alias.hold=!sleep 3', 'hold'], { cwd, env: { ...env, OPENDOTS_GIT_TOKEN: 'broker-test-only' }, stdio: 'ignore' });
    try {
      const scan = await exec('docker', ['exec', '-u', who.stdout.trim(), status.container!.name, 'sh', '-c', 'for f in /proc/[0-9]*/environ; do if grep -azq "^OPENDOTS_GIT_TOKEN=broker-test-only$" "$f" 2>/dev/null; then echo LEAK; exit 1; fi; done; echo ISOLATED']);
      expect(scan.stdout.trim()).toBe('ISOLATED');
    } finally { child.kill('SIGKILL'); }
  });
  await expect(access(snapshotPath)).rejects.toThrow();
  expect((await execShell(agent.id, 'cd project && echo changed >> file.txt && git commit -qam changed')).exitCode).toBe(0);
  await expect(withApprovedSnapshot(request, async () => { throw new Error('Must not reach credentialed transport'); })).rejects.toThrow('branche a changé');
  await expect(withApprovedSnapshot({ ...request, expectedSha: '' }, async () => null)).rejects.toThrow('obsolète');
  const sanitized = brokerEnvironment('/tmp/clean');
  expect(sanitized.GIT_CONFIG_GLOBAL).toBe('/dev/null');
  expect(sanitized.GIT_CONFIG_COUNT).toBeUndefined();
  expect(sanitized.LD_PRELOAD).toBeUndefined();
  expect(sanitized.OPENDOTS_GIT_TOKEN).toBeUndefined();
  // The workspace contains source data only, never broker directories/tokens.
  expect((await execShell(agent.id, `find /workspaces -name 'opendots-push-*'`)).stdout.trim()).toBe('');
}, 120_000);

it('recreates a legacy shell container to apply SELinux labels while retaining workspace files', async () => {
  const agent = await createAgent({ name: 'Upgrade' });
  const original = await execShell(agent.id, 'echo retained > migration.txt; id -u');
  const before = await computerStatus();
  const name = before.container!.name;
  const image = before.settings.image;
  await exec('docker', ['rm', '-f', name]);
  await exec('docker', ['run', '-d', '--name', name, '--label', `opendots.image=${image}`, '--label', 'opendots.network=on', '--label', `opendots.workspaces=${config.dataDir}/workspaces`, '-v', `${config.dataDir}/workspaces:/workspaces`, image, 'sleep', 'infinity']);
  // Simulate the old allocator's UID while keeping the same bot's private home.
  await exec('docker', ['exec', name, 'chown', '-hR', '1000', `/workspaces/${agent.id}`]);
  const oldId = (await exec('docker', ['inspect', '-f', '{{.Id}}', name])).stdout.trim();
  const restored = await execShell(agent.id, 'cat migration.txt; id -u');
  expect(restored.exitCode, restored.stderr).toBe(0);
  expect(restored.stdout).toContain('retained');
  expect(restored.stdout).toContain(original.stdout.trim());
  const inspected = (await exec('docker', ['inspect', '-f', '{{.Id}}|{{index .Config.Labels "opendots.revision"}}|{{json .HostConfig.Binds}}', name])).stdout.trim();
  expect(inspected.split('|')[0]).not.toBe(oldId);
  expect(inspected).toContain('3-bot-sessions');
  expect(inspected).toContain('/workspaces:Z');
}, 120_000);
