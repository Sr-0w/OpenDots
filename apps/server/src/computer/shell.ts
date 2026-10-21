import { spawn, execFile } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.ts';
import { BUILTIN_COMPUTER_IMAGE, getShellSettings, type ShellSettings } from '../settings.ts';
import { truncate } from '../util.ts';
import { createHash } from 'node:crypto';
import { accountKey, currentAccount } from '../auth/context.ts';

/**
 * L'ordinateur des compagnons (section 10) : un seul conteneur Linux partagé,
 * un utilisateur et un dossier personnel par compagnon, un dossier commun.
 * Sans Docker, les commandes s'exécutent sur la machine hôte, dans le dossier
 * du compagnon, et demandent alors une validation par défaut.
 */
const run = promisify(execFile);
const container = () => (process.env.OPENDOTS_CONTAINER ?? 'opendots-computer') + (currentAccount() ? `-${createHash('sha256').update(accountKey()).digest('hex').slice(0, 12)}` : '');
const MAX_OUTPUT = 200_000;

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

function linuxUser(agentId: string) {
  return `agent_${agentId.replace(/^ag_/, '').slice(0, 12)}`;
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

async function inspect(): Promise<{ running: boolean; image: string; network: string; workspaces: string } | null> {
  try {
    const { stdout } = await run(
      'docker',
      ['inspect', '-f', '{{.State.Running}}|{{index .Config.Labels "opendots.image"}}|{{index .Config.Labels "opendots.network"}}|{{index .Config.Labels "opendots.workspaces"}}', container()],
      { timeout: 10_000 },
    );
    const [running, image, network, workspaces] = stdout.trim().split('|');
    return { running: running === 'true', image, network, workspaces };
  } catch {
    return null;
  }
}

/** Image par défaut : Debian avec les outils courants d'un poste de travail en ligne de commande. */
const BUILTIN_DOCKERFILE = `FROM debian:stable-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y --no-install-recommends \\
    python3 python3-pip python3-venv nodejs npm git curl wget jq ca-certificates \\
    unzip zip xz-utils sqlite3 less nano file procps sudo tzdata locales bc \\
  && rm -rf /var/lib/apt/lists/*
`;

async function ensureImage(image: string) {
  try {
    await run('docker', ['image', 'inspect', image], { timeout: 15_000 });
    return;
  } catch {
    // image absente
  }
  if (image === BUILTIN_COMPUTER_IMAGE) {
    await new Promise<void>((resolve, reject) => {
      // Derrière un proxy d'entreprise, la construction passe par le même proxy.
      const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
      const proxyArgs = proxy
        ? ['--build-arg', `http_proxy=${proxy}`, '--build-arg', `https_proxy=${proxy}`, ...(/127\.0\.0\.1|localhost/.test(proxy) ? ['--network', 'host'] : [])]
        : [];
      const child = spawn('docker', ['build', ...proxyArgs, '-t', image, '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err = (err + d.toString()).slice(-4000)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Construction de l’image impossible : ${err.trim().split('\n').pop()}`))));
      child.on('error', reject);
      child.stdin.end(BUILTIN_DOCKERFILE);
    });
  } else {
    await run('docker', ['pull', image], { timeout: 600_000 });
  }
}

const ensuring = new Map<string, Promise<void>>();

export async function ensureContainer(settings?: ShellSettings): Promise<void> {
  const key = accountKey();
  if (ensuring.has(key)) return ensuring.get(key)!;
  const pending = (async () => {
    const s = settings ?? (await getShellSettings());
    mkdirSync(join(workspacesDir(), 'shared'), { recursive: true });
    chmodSync(workspacesDir(), 0o755);
    const state = await inspect();
    const network = s.network ? 'on' : 'off';
    if (state && (state.image !== s.image || state.network !== network || state.workspaces !== workspacesDir())) {
      await run('docker', ['rm', '-f', container()], { timeout: 30_000 }).catch(() => {});
    } else if (state?.running) {
      return;
    } else if (state) {
      await run('docker', ['start', container()], { timeout: 30_000 });
      return;
    }
    await ensureImage(s.image);
    await run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        container(),
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
        ...(s.network ? [] : ['--network', 'none']),
        '--memory',
        process.env.OPENDOTS_COMPUTER_MEMORY ?? '2g',
        '--pids-limit',
        '512',
        '-v',
        `${workspacesDir()}:/workspaces`,
        '-w',
        '/workspaces',
        s.image,
        'sleep',
        'infinity',
      ],
      { timeout: 300_000 },
    );
    await run('docker', ['exec', container(), 'sh', '-c', 'chmod 1777 /workspaces/shared'], { timeout: 15_000 });
  })().finally(() => {
    ensuring.delete(key);
  });
  ensuring.set(key, pending);
  return pending;
}

async function ensureUser(agentId: string, sudo: boolean) {
  const user = linuxUser(agentId);
  const home = `/workspaces/${agentId}`;
  const sudoers = sudo
    ? `mkdir -p /etc/sudoers.d && echo '${user} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${user} && chmod 440 /etc/sudoers.d/${user}`
    : `rm -f /etc/sudoers.d/${user}`;
  await run(
    'docker',
    [
      'exec',
      container(),
      'sh',
      '-c',
      `id -u ${user} >/dev/null 2>&1 || useradd -M -d ${home} -s /bin/bash ${user} 2>/dev/null || adduser -D -h ${home} ${user}; mkdir -p ${home} && chown ${user} ${home} && chmod 700 ${home}; ${sudoers}`,
    ],
    { timeout: 20_000 },
  );
  return { user, home };
}

export async function computerStatus() {
  const settings = await getShellSettings();
  const docker = await dockerAvailable();
  const backend = await resolveBackend(settings);
  const state = docker ? await inspect() : null;
  return {
    settings,
    dockerAvailable: docker,
    backend,
    container: state ? { name: container(), running: state.running, image: state.image, network: state.network === 'on' } : null,
    approvalRequired: await shellNeedsApproval(),
    workspaces: workspacesDir(),
  };
}

export async function resetContainer() {
  if (!(await dockerAvailable())) throw new Error('Docker n’est pas disponible.');
  await run('docker', ['rm', '-f', container()], { timeout: 30_000 }).catch(() => {});
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
  const settings = await getShellSettings();
  const backend = await resolveBackend(settings);
  if (!backend) throw new Error('Le shell est désactivé dans les paramètres.');
  const timeoutMs = Math.min(Math.max(opts.timeoutSeconds ?? 120, 1), 1800) * 1000;
  const started = Date.now();
  const hostHome = ensureHostDirs(agentId);

  if (backend === 'docker') {
    if (!(await dockerAvailable())) throw new Error('Docker n’est pas disponible : choisis le mode « machine hôte » dans les paramètres.');
    await ensureContainer(settings);
    const { user, home } = await ensureUser(agentId, settings.sudo);
    const child = spawn('docker', ['exec', '-i', '-u', user, '-w', home, '-e', `HOME=${home}`, '-e', 'TERM=dumb', container(), 'bash', '-lc', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const r = await collect(child, timeoutMs, () => {
      child.kill('SIGKILL');
      // Interrompt aussi les processus lancés dans le conteneur par cette commande.
      void run('docker', ['exec', container(), 'pkill', '-KILL', '-u', user]).catch(() => {});
    });
    return { backend, exitCode: r.code, stdout: r.stdout, stderr: r.stderr, durationMs: Date.now() - started, timedOut: r.timedOut, cwd: home };
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
