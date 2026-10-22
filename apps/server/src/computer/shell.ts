import { spawn, execFile } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config, repoRoot, systemDataDir } from '../config.ts';
import { BUILTIN_COMPUTER_IMAGE, getShellSettings, type ShellSettings } from '../settings.ts';
import { truncate, KeyedMutex } from '../util.ts';
import { createHash } from 'node:crypto';
import { accountKey, currentAccount, withAccount } from '../auth/context.ts';
import { computerSlot } from './session.ts';

/**
 * L'ordinateur des compagnons (section 10) : un seul conteneur Linux partagé,
 * un utilisateur et un dossier personnel par compagnon, un dossier commun.
 * Sans Docker, les commandes s'exécutent sur la machine hôte, dans le dossier
 * du compagnon, et demandent alors une validation par défaut.
 */
const run = promisify(execFile);
export const computerName = () => (process.env.OPENDOTS_CONTAINER ?? 'opendots-computer') + (currentAccount() ? `-${createHash('sha256').update(accountKey()).digest('hex').slice(0, 12)}` : '');
const MAX_OUTPUT = 200_000;
const CONTAINER_REVISION = '3-bot-sessions';

export const workspacesDir = () => join(config.dataDir, 'workspaces');

export type Backend = 'docker' | 'host';

export interface ShellResult {
  backend: Backend;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cwd: string;
}

let dockerCheck: { at: number; ok: boolean } | null = null;

export async function dockerAvailable(): Promise<boolean> {
  if (dockerCheck && Date.now() - dockerCheck.at < 60_000) return dockerCheck.ok;
  let ok = false;
  try {
    await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5_000 });
    ok = true;
  } catch {
    ok = false;
  }
  dockerCheck = { at: Date.now(), ok };
  return ok;
}

export async function resolveBackend(s?: ShellSettings): Promise<Backend | null> {
  const settings = s ?? (await getShellSettings());
  if (settings.mode === 'off') return null;
  // A host shell could read other accounts' files under the same OS user.
  if (currentAccount()) return settings.mode !== 'host' && await dockerAvailable() ? 'docker' : null;
  if (settings.mode === 'host') return 'host';
  if (settings.mode === 'docker') return 'docker';
  return (await dockerAvailable()) ? 'docker' : 'host';
}

/** Les commandes demandent-elles une validation ? */
export async function shellNeedsApproval(): Promise<boolean> {
  const s = await getShellSettings();
  if (s.approval === 'ask') return true;
  if (s.approval === 'auto') return false;
  return (await resolveBackend(s)) !== 'docker';
}

export function linuxUser(agentId: string) {
  if (!/^ag_[a-zA-Z0-9_]+$/.test(agentId)) throw new Error('Compagnon invalide.');
  return `agent_${createHash('sha256').update(agentId).digest('hex').slice(0, 16)}`;
}

function ensureHostDirs(agentId: string) {
  const root = workspacesDir();
  mkdirSync(join(root, 'shared'), { recursive: true });
  chmodSync(root, 0o755);
  const home = join(root, agentId);
  mkdirSync(home, { recursive: true });
  try {
    chmodSync(join(root, 'shared'), 0o1777);
  } catch {
    // système de fichiers sans permissions POSIX
  }
  return home;
}

// --- Conteneur ----------------------------------------------------------------

export async function computerState(): Promise<{ id: string; generation: string; paused: boolean; running: boolean; image: string; network: string; workspaces: string; revision: string; imageId: string } | null> {
  try {
    const { stdout } = await run(
      'docker',
      ['inspect', '-f', '{{.Id}}|{{.State.StartedAt}}|{{.State.Paused}}|{{.State.Running}}|{{index .Config.Labels "opendots.image"}}|{{index .Config.Labels "opendots.network"}}|{{index .Config.Labels "opendots.workspaces"}}|{{index .Config.Labels "opendots.revision"}}|{{.Image}}', computerName()],
      { timeout: 10_000 },
    );
    const [id, startedAt, paused, running, image, network, workspaces, revision, imageId] = stdout.trim().split('|');
    return { id, generation: `${id}:${startedAt}`, paused: paused === 'true', running: running === 'true', image, network, workspaces, revision, imageId };
  } catch {
    return null;
  }
}

export async function ensureImage(image: string, force = false) {
  try {
    if (force) throw new Error('rebuild');
    await run('docker', ['image', 'inspect', image], { timeout: 15_000 });
    return;
  } catch {
    // image absente
  }
  if (image === BUILTIN_COMPUTER_IMAGE) {
    // Derrière un proxy d'entreprise, la construction passe par le même proxy.
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
    const proxyHost = proxy ? new URL(proxy).hostname : undefined;
    const address = proxyHost ? (await lookup(proxyHost)).address : undefined;
    const proxyArgs = proxy
      ? ['--add-host', `${proxyHost}:${address}`, '--build-arg', `http_proxy=${proxy}`, '--build-arg', `https_proxy=${proxy}`, ...(/127\.0\.0\.1|localhost/.test(proxy) ? ['--network', 'host'] : [])]
      : [];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('docker', ['build', ...proxyArgs, ...(process.env.SSL_CERT_FILE || process.env.CODEX_PROXY_CERT ? ['--secret', `id=opendots_ca,src=${process.env.SSL_CERT_FILE ?? process.env.CODEX_PROXY_CERT}`] : []), '-t', image, '-f', join(repoRoot, 'apps/server/computer/Dockerfile'), join(repoRoot, 'apps/server/computer')], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err = (err + d.toString()).slice(-4000)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Construction de l’image impossible : ${err.trim().split('\n').pop()}`))));
      child.on('error', reject);
    });
  } else {
    await run('docker', ['pull', image], { timeout: 600_000 });
  }
}

const ensuring = new Map<string, Promise<void>>();
const lifecycle = new KeyedMutex();

export async function ensureContainer(settings?: ShellSettings): Promise<void> {
  const key = accountKey();
  if (ensuring.has(key)) return ensuring.get(key)!;
  const pending = lifecycle.run(key, async () => {
    const s = settings ?? (await getShellSettings());
    mkdirSync(join(workspacesDir(), 'shared'), { recursive: true });
    chmodSync(workspacesDir(), 0o755);
    await ensureImage(s.image);
    const imageId = (await run('docker', ['image', 'inspect', '--format', '{{.Id}}', s.image], { timeout: 15_000 })).stdout.trim();
    const revision = `${CONTAINER_REVISION}:${process.env.OPENDOTS_COMPUTER_MEMORY ?? '4g'}:${process.env.OPENDOTS_COMPUTER_CPUS ?? '2'}:${process.env.OPENDOTS_COMPUTER_PIDS ?? '2048'}`;
    const state = await computerState();
    const network = s.network ? 'on' : 'off';
    if (state && (state.image !== s.image || state.imageId !== imageId || state.network !== network || state.workspaces !== workspacesDir() || state.revision !== revision)) {
      await run('docker', ['rm', '-f', computerName()], { timeout: 30_000 }).catch(() => {});
    } else if (state?.running) {
      if (state.paused) await run('docker', ['unpause', computerName()], { timeout: 15_000 });
      touchComputer();
      return;
    } else if (state) {
      await run('docker', ['start', computerName()], { timeout: 30_000 });
      touchComputer();
      return;
    }
    const certificate = process.env.CODEX_PROXY_CERT;
    let ca: string[] = [];
    if (certificate) {
      const directory = join(systemDataDir, 'computer-build');
      await mkdir(directory, { recursive: true, mode: 0o755 });
      const data = await readFile(certificate, 'utf8');
      if (!data.includes('BEGIN CERTIFICATE') || data.includes('PRIVATE KEY')) throw new Error('Certificat public invalide.');
      const file = join(directory, 'proxy.crt');
      await writeFile(file, data, { mode: 0o644 });
      await chmod(file, 0o644);
      ca = ['-v', `${file}:/usr/local/share/ca-certificates/opendots-proxy.crt:ro,z`];
    }
    await run(
      'docker',
      [
        'run',
        '--init',
        '-d',
        '--name',
        computerName(),
        '--hostname',
        'opendots',
        '--restart',
        'unless-stopped',
        '--label',
        `opendots.image=${s.image}`,
        '--label',
        `opendots.network=${network}`,
        '--label',
        `opendots.workspaces=${workspacesDir()}`,
        '--label', `opendots.revision=${revision}`,
        ...(s.network ? [] : ['--network', 'none']),
        '--memory',
        process.env.OPENDOTS_COMPUTER_MEMORY ?? '4g',
        '--cpus',
        process.env.OPENDOTS_COMPUTER_CPUS ?? '2',
        '--pids-limit',
        process.env.OPENDOTS_COMPUTER_PIDS ?? '2048',
        '--shm-size', '512m',
        ...ca,
        '-v',
        `${workspacesDir()}:/workspaces:Z`,
        '-w',
        '/workspaces',
        s.image,
        'sleep',
        'infinity',
      ],
      { timeout: 300_000 },
    );
    await run('docker', ['exec', computerName(), 'sh', '-c', 'chmod 1777 /workspaces/shared'], { timeout: 15_000 });
    touchComputer();
  }).finally(() => {
    ensuring.delete(key);
  });
  ensuring.set(key, pending);
  return pending;
}

export async function ensureComputerUser(agentId: string, sudo: boolean) {
  const user = linuxUser(agentId);
  const slot = await computerSlot(agentId), uid = 20000 + slot;
  const home = `/workspaces/${agentId}`;
  const sudoers = sudo
    ? `mkdir -p /etc/sudoers.d && echo '${user} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${user} && chmod 440 /etc/sudoers.d/${user}`
    : `rm -f /etc/sudoers.d/${user}`;
  await run(
    'docker',
    [
      'exec',
      computerName(),
      'sh',
      '-c',
      `mkdir -p ${home}; if ! id -u ${user} >/dev/null 2>&1; then useradd -u ${uid} -M -d ${home} -s /bin/bash ${user} 2>/dev/null || adduser -D -u ${uid} -h ${home} ${user}; chown -hR ${user} ${home}; fi; chown ${user} ${home} && chmod 700 ${home}; ${sudoers}`,
    ],
    { timeout: 20_000 },
  );
  return { user, home, slot };
}

export async function computerStatus() {
  const settings = await getShellSettings();
  const docker = await dockerAvailable();
  const backend = await resolveBackend(settings);
  const state = docker ? await computerState() : null;
  return {
    settings,
    dockerAvailable: docker,
    backend,
    container: state ? { name: computerName(), running: state.running, image: state.image, network: state.network === 'on' } : null,
    approvalRequired: await shellNeedsApproval(),
    workspaces: workspacesDir(),
    suspended: state?.paused ?? false,
  };
}

export async function resetContainer() {
  if (!(await dockerAvailable())) throw new Error('Docker n’est pas disponible.');
  await run('docker', ['rm', '-f', computerName()], { timeout: 30_000 }).catch(() => {});
  await ensureContainer();
}

// --- Exécution ------------------------------------------------------------------

function collect(child: ReturnType<typeof spawn>, timeoutMs: number, onTimeout: () => void) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8');
    });
    const timer = setTimeout(() => {
      timedOut = true;
      onTimeout();
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
  });
}

export async function execShell(agentId: string, command: string, opts: { timeoutSeconds?: number } = {}): Promise<ShellResult> {
  const release = leaseComputer();
  try { return await executeShell(agentId, command, opts); } finally { release(); }
}
async function executeShell(agentId: string, command: string, opts: { timeoutSeconds?: number }): Promise<ShellResult> {
  const settings = await getShellSettings();
  const backend = await resolveBackend(settings);
  if (!backend) throw new Error('Le shell est désactivé dans les paramètres.');
  const timeoutMs = Math.min(Math.max(opts.timeoutSeconds ?? 120, 1), 1800) * 1000;
  const started = Date.now();
  const hostHome = ensureHostDirs(agentId);

  if (backend === 'docker') {
    if (!(await dockerAvailable())) throw new Error('Docker n’est pas disponible : choisis le mode « machine hôte » dans les paramètres.');
    await ensureContainer(settings);
    const { user, home, slot } = await ensureComputerUser(agentId, settings.sudo);
    const runner = ['sh', '-c', 'if command -v opendots-shell-run >/dev/null 2>&1; then exec opendots-shell-run "$1" "$2"; else printf "[OpenDots] Image personnalisée ancienne : mets-la à jour pour les processus graphiques en arrière-plan.\\n" >&2; exec timeout -k 1 "$1" bash -lc "$2"; fi', 'opendots-shell', String(timeoutMs / 1000), command];
    const child = spawn('docker', ['exec', '-i', '-u', user, '-w', home, '-e', `HOME=${home}`, '-e', `DISPLAY=:${slot}`, '-e', `XAUTHORITY=${home}/.Xauthority`, '-e', `XDG_RUNTIME_DIR=/tmp/runtime-${user}`, '-e', 'TERM=dumb', computerName(), ...runner], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const r = await collect(child, timeoutMs + 2000, () => {
      child.kill('SIGKILL');
    });
    // GNU timeout owns a command process group. Never kill every process of the
    // bot's UID: its browser and X server now live in the same account container.
    const timedOut = r.timedOut || r.code === 124 || (r.code === 137 && Date.now() - started >= timeoutMs);
    return { backend, exitCode: r.code, stdout: r.stdout, stderr: r.stderr, durationMs: Date.now() - started, timedOut, cwd: home };
  }

  const child = spawn('bash', ['-lc', command], {
    cwd: hostHome,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: hostHome, LANG: 'C.UTF-8', TERM: 'dumb', OPENDOTS_SHARED: join(workspacesDir(), 'shared') },
  });
  const r = await collect(child, timeoutMs, () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  });
  return { backend, exitCode: r.code, stdout: r.stdout, stderr: r.stderr, durationMs: Date.now() - started, timedOut: r.timedOut, cwd: hostHome };
}

/** Version compacte pour le modèle. */
export function shellForModel(r: ShellResult) {
  return {
    ok: r.exitCode === 0 && !r.timedOut,
    exit_code: r.exitCode,
    timed_out: r.timedOut,
    duration_ms: r.durationMs,
    computer: r.backend === 'docker' ? 'conteneur Linux partagé' : 'machine hôte',
    cwd: r.cwd,
    stdout: truncate(r.stdout, 12_000),
    stderr: truncate(r.stderr, 4_000),
  };
}

// Credential-free snapshot export; authenticated Git runs only in git-broker.ts.
export interface GitSnapshotRequest { agentId: string; path: string; branch: string }

async function companionGit(r: GitSnapshotRequest, args: string[], maxBuffer = 1024 * 1024) {
  const release = leaseComputer();
  try {
  if (!/^ag_[a-zA-Z0-9_]+$/.test(r.agentId) || !/^[a-zA-Z0-9._/-]*$/.test(r.path) || r.path.startsWith('/') || r.path.split('/').includes('..')) throw new Error('Dossier de compagnon invalide.');
  if (!/^[a-zA-Z0-9._/-]+$/.test(r.branch) || r.branch.startsWith('-') || r.branch.includes('..')) throw new Error('Branche invalide.');
  const settings = await getShellSettings();
  if ((await resolveBackend(settings)) !== 'docker' || !(await dockerAvailable())) throw new Error('Le push nécessite l’ordinateur Docker isolé du compagnon.');
  if (settings.sudo) throw new Error('Désactive sudo avant de préparer un push.');
  if (!settings.network) throw new Error('L’ordinateur du compagnon n’a pas accès au réseau.');
  await ensureContainer(settings);
  const { user, home } = await ensureComputerUser(r.agentId, false);
  const cwd = !r.path || r.path === '.' ? home : `${home}/${r.path}`;
  return await run('docker', ['exec', '-u', user, '-w', cwd, '-e', `HOME=${home}`, '-e', 'GIT_TERMINAL_PROMPT=0', computerName(), '/usr/bin/git', ...args], { encoding: 'buffer', timeout: 60_000, maxBuffer });
  } finally { release(); }
}

export async function companionGitHead(r: GitSnapshotRequest): Promise<string> {
  const { stdout } = await companionGit(r, ['rev-parse', '--verify', `refs/heads/${r.branch}^{commit}`]);
  const sha = stdout.toString('utf8').trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Commit Git introuvable ou format non pris en charge.');
  return sha;
}

export async function companionGitBundle(r: GitSnapshotRequest): Promise<Buffer> {
  // Bundle contains objects and refs only, never source config/hooks/alternates.
  const { stdout } = await companionGit(r, ['bundle', 'create', '-', `refs/heads/${r.branch}`], 128 * 1024 * 1024);
  return stdout;
}

export async function setCompanionUpstream(r: GitSnapshotRequest, repo: string) {
  await companionGit(r, ['config', `branch.${r.branch}.remote`, `https://github.com/${repo}.git`]);
  await companionGit(r, ['config', `branch.${r.branch}.merge`, `refs/heads/${r.branch}`]);
}

// Retain private sessions in RAM while idle. Never freeze active shell jobs or viewers.
const idle = new Map<string, { leases: number; timer?: ReturnType<typeof setTimeout> }>();
export function touchComputer() {
  const key = accountKey();
  const state = idle.get(key) ?? { leases: 0 };
  if (state.timer) clearTimeout(state.timer);
  idle.set(key, state);
  const seconds = Number(process.env.OPENDOTS_COMPUTER_IDLE_SECONDS ?? 300);
  if (state.leases || !Number.isFinite(seconds) || seconds <= 0) return;
  state.timer = setTimeout(() => {
    void lifecycle.run(key, async () => {
      if (state.leases || ensuring.has(key)) return touchComputer();
      const current = await computerState();
      if (current?.running && !current.paused && !state.leases) await run('docker', ['pause', computerName()], { timeout: 15_000 });
    }).catch(() => {});
  }, Math.min(seconds * 1000, 2 ** 31 - 1));
  state.timer.unref();
}
export function leaseComputer() {
  const account = currentAccount();
  const key = accountKey();
  const state = idle.get(key) ?? { leases: 0 };
  state.leases++;
  if (state.timer) clearTimeout(state.timer);
  idle.set(key, state);
  let released = false;
  return () => { if (released) return; released = true; state.leases--; withAccount(account, touchComputer); };
}
