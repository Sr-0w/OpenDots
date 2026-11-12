import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { BrowserSessionError, browserPresencePy, clarifyBrowserFailure, ensureBrowserSession, type BrowserPresence, type BrowserSessionDeps } from '../src/computer/browser-session.ts';

const run = promisify(execFile);
const bridge = fileURLToPath(new URL('../computer/semantic-bridge.py', import.meta.url));

function session(state: BrowserPresence, ready = true) {
  const calls = { start: 0, launch: 0, wait: 0, presence: 0 };
  let authorized = true, taken = false, current = state, becomesReady = ready;
  const deps: BrowserSessionDeps = {
    authorized: async () => authorized,
    takenOver: async () => taken,
    startDesktop: async () => { calls.start++; },
    presence: async () => { calls.presence++; return current; },
    launch: async () => { calls.launch++; },
    waitUntilReady: async () => { calls.wait++; return becomesReady; },
  };
  return {
    deps, calls,
    allow: (value: boolean) => { authorized = value; },
    take: (value: boolean) => { taken = value; },
    setState: (value: BrowserPresence) => { current = value; },
    setReady: (value: boolean) => { becomesReady = value; },
  };
}

it('réutilise une session prête et ne lance rien', async () => {
  const { deps, calls } = session('ready');
  await ensureBrowserSession('ready', deps, new Map());
  expect(calls).toMatchObject({ start: 1, launch: 0, wait: 0 });
});

it('démarre le bureau puis un seul navigateur quand rien ne tourne', async () => {
  const { deps, calls } = session('absent');
  await ensureBrowserSession('absent', deps, new Map());
  expect(calls).toMatchObject({ start: 1, launch: 1, wait: 1 });
});

it('attend le fichier d’état sans relancer Chromium déjà ouvert', async () => {
  const { deps, calls } = session('process');
  await ensureBrowserSession('process', deps, new Map());
  expect(calls).toMatchObject({ start: 1, launch: 0, wait: 1 });
});

it('refuse de démarrer un bureau non autorisé ou repris par l’utilisateur', async () => {
  const denied = session('absent');
  denied.allow(false);
  await expect(ensureBrowserSession('denied', denied.deps, new Map())).rejects.toThrow(BrowserSessionError);
  await expect(ensureBrowserSession('denied', denied.deps, new Map())).rejects.toThrow(/non autorisé/);
  expect(denied.calls).toMatchObject({ start: 0, launch: 0 });
  const manual = session('absent');
  manual.take(true);
  await expect(ensureBrowserSession('manual', manual.deps, new Map())).rejects.toThrow(/pris la main/);
  expect(manual.calls).toMatchObject({ start: 0, launch: 0 });
});

it('annule le lancement si l’autorisation disparaît après le démarrage du bureau', async () => {
  const { deps, calls, allow } = session('absent');
  deps.authorized = async () => { const allowed = calls.start === 0; if (!allowed) allow(false); return calls.start === 0; };
  await expect(ensureBrowserSession('revoked', deps, new Map())).rejects.toThrow(/annulé/);
  expect(calls).toMatchObject({ start: 1, launch: 0, wait: 0 });
});

it('explique l’absence de session sans lancer un second navigateur', async () => {
  const stuck = session('process', false);
  await expect(ensureBrowserSession('stuck', stuck.deps, new Map())).rejects.toThrow(/déjà ouvert/);
  expect(stuck.calls.launch).toBe(0);
  const missing = session('absent', false);
  await expect(ensureBrowserSession('missing', missing.deps, new Map())).rejects.toThrow(/active\.json est absent/);
  expect(missing.calls.launch).toBe(1);
});

it('partage un démarrage concurrent et isole les compagnons', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let launches = 0;
  const deps: BrowserSessionDeps = {
    authorized: async () => true,
    takenOver: async () => false,
    startDesktop: async () => {},
    presence: async () => 'absent',
    launch: async () => { launches++; await gate; },
    waitUntilReady: async () => true,
  };
  const flights = new Map<string, Promise<void>>();
  const other: BrowserSessionDeps = { ...deps, launch: async () => { launches++; } };
  const first = ensureBrowserSession('bot-a', deps, flights);
  const second = ensureBrowserSession('bot-a', deps, flights);
  const third = ensureBrowserSession('bot-b', other, flights);
  expect(flights.size).toBe(2);
  release();
  await Promise.all([first, second, third]);
  expect(launches).toBe(2);
  expect(flights.size).toBe(0);
});

it('peut réessayer après un échec de lancement', async () => {
  const flights = new Map<string, Promise<void>>();
  let fail = true;
  const { deps } = session('absent');
  deps.launch = async () => { if (fail) throw new Error('Fenêtre non visible'); };
  await expect(ensureBrowserSession('retry', deps, flights)).rejects.toThrow(/Fenêtre/);
  await Promise.resolve();
  fail = false;
  await ensureBrowserSession('retry', deps, flights);
});

it('traduit l’ENOENT brut de active.json', () => {
  const raw = "[Errno 2] No such file or directory: '/tmp/runtime-agent_d2b617b4c17a0e90/obu/active.json'";
  expect(clarifyBrowserFailure(raw)).toMatch(/pas prêt/);
  expect(clarifyBrowserFailure(raw)).not.toMatch(/Errno 2/);
  expect(clarifyBrowserFailure("[Errno 2] No such file or directory: '/tmp/runtime-agent_x/obu/abc.sock'")).not.toMatch(/Errno/);
  expect(clarifyBrowserFailure("[Errno 2] No such file or directory: '/proc/15'")).toBe("[Errno 2] No such file or directory: '/proc/15'");
  expect(clarifyBrowserFailure('Element changed: inspect again')).toBe('Element changed: inspect again');
});

async function probe(runtime: string, mode: string, env: NodeJS.ProcessEnv) {
  const { stdout } = await run('python3', ['-c', browserPresencePy, mode], { env: { ...process.env, ...env, XDG_RUNTIME_DIR: runtime }, timeout: 5_000 });
  return stdout.toString();
}

it('détecte une session absente, un processus sans socket, puis une session prête', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obu-probe-'));
  const bin = join(root, 'bin');
  const obu = join(root, 'obu');
  const sockPath = join(obu, 'browser.sock');
  await mkdir(bin);
  await writeFile(join(bin, 'pgrep'), '#!/usr/bin/env python3\nimport os,sys\nif os.environ.get("FAKE_CHROMIUM")=="1":\n    print("4242")\n    raise SystemExit(0)\nraise SystemExit(1)\n', { mode: 0o755 });
  await writeFile(join(bin, 'xdotool'), '#!/usr/bin/env python3\nimport os,sys\nflag=os.environ.get("WINDOW_FLAG","")\nif os.environ.get("FAKE_WINDOW")=="1" or (flag and os.path.exists(flag)):\n    print("99")\n    raise SystemExit(0)\nraise SystemExit(1)\n', { mode: 0o755 });
  await chmod(join(bin, 'pgrep'), 0o755);
  await chmod(join(bin, 'xdotool'), 0o755);
  const env: NodeJS.ProcessEnv = { PATH: `${bin}:${process.env.PATH}`, FAKE_CHROMIUM: '0', FAKE_WINDOW: '0' };
  try {
    expect(await probe(root, 'status', env)).toBe('absent');
    expect(await probe(root, 'wait', { ...env, OPENDOTS_BROWSER_WAIT_SECONDS: '0.3' })).toBe('missing');
    await mkdir(obu);
    env.FAKE_CHROMIUM = '1';
    expect(await probe(root, 'status', env)).toBe('process');
    await writeFile(join(obu, 'active.json'), JSON.stringify({ socketPath: join(obu, 'not-a-socket') }));
    await writeFile(join(obu, 'not-a-socket'), 'file');
    expect(await probe(root, 'status', env)).toBe('process');
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(sockPath, () => resolve()); });
    try {
      await writeFile(join(obu, 'active.json'), JSON.stringify({ socketPath: sockPath }));
      expect(await probe(root, 'status', env)).toBe('ready');
      expect(await probe(root, 'wait', env)).toBe('ready');
      env.FAKE_CHROMIUM = '0';
      expect(await probe(root, 'status', env)).toBe('absent');
      env.FAKE_WINDOW = '1';
      expect(await probe(root, 'status', env)).toBe('ready');
    } finally { server.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

function runBridge(runtime: string, request: unknown) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('python3', [bridge], { env: { ...process.env, XDG_RUNTIME_DIR: runtime } });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`bridge hang\n${stdout}\n${stderr}`)); }, 5_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

it('réutilise une fenêtre déjà visible et survit au délai de 4 s du lanceur', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obu-launch-'));
  const bin = join(root, 'bin');
  const log = join(root, 'launches');
  const flag = join(root, 'window');
  await mkdir(bin);
  const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_CHROMIUM: '0', FAKE_WINDOW: '0', FAKE_LATE_WINDOW: '0', WINDOW_FLAG: flag, LAUNCH_LOG: log, OPENDOTS_BROWSER_LAUNCH_WAIT_SECONDS: '0.4' };
  await writeFile(join(bin, 'pgrep'), '#!/usr/bin/env python3\nimport os\nraise SystemExit(0 if os.environ.get("FAKE_CHROMIUM")=="1" else 1)\n', { mode: 0o755 });
  await writeFile(join(bin, 'xdotool'), '#!/usr/bin/env python3\nimport os\nflag=os.environ.get("WINDOW_FLAG","")\nif os.environ.get("FAKE_WINDOW")=="1" or (flag and os.path.exists(flag)):\n    print("99")\n    raise SystemExit(0)\nraise SystemExit(1)\n', { mode: 0o755 });
  await writeFile(join(bin, 'opendots-open-browser'), '#!/usr/bin/env python3\nimport os,sys\nopen(os.environ["LAUNCH_LOG"],"a").write("launch\\n")\nif os.environ.get("FAKE_LATE_WINDOW")=="1":\n    open(os.environ["WINDOW_FLAG"],"w").write("1")\nsys.stderr.write("Fenêtre non visible après 4 s. Consulte /tmp/chromium.log, puis reprends une capture.\\n")\nraise SystemExit(1)\n', { mode: 0o755 });
  for (const name of ['pgrep', 'xdotool', 'opendots-open-browser']) await chmod(join(bin, name), 0o755);
  const runLaunch = (extra: NodeJS.ProcessEnv) => run('python3', ['-c', browserPresencePy, 'launch'], { env: { ...process.env, ...env, ...extra, XDG_RUNTIME_DIR: root }, timeout: 5_000 }).then(() => ({ code: 0, stderr: '' }), (error: { code?: number; stderr?: string }) => ({ code: error.code ?? 1, stderr: String(error.stderr ?? '') }));
  try {
    expect((await runLaunch({ FAKE_WINDOW: '1' })).code).toBe(0);
    expect(await readLaunchCount(log)).toBe(0);
    expect((await runLaunch({ FAKE_LATE_WINDOW: '1' })).code).toBe(0);
    expect(await readLaunchCount(log)).toBe(1);
    await rm(flag, { force: true });
    const failed = await runLaunch({});
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toMatch(/Fenêtre non visible/);
    expect(await readLaunchCount(log)).toBe(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function readLaunchCount(log: string) {
  try { return (await (await import('node:fs/promises')).readFile(log, 'utf8')).trim().split('\n').filter(Boolean).length; } catch { return 0; }
}

it('remplace le fichier d’état manquant par une erreur explicite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obu-bridge-'));
  try {
    const missing = await runBridge(root, { engine: 'browser', action: 'tabs' });
    expect(missing.code).toBe(0);
    const body = JSON.parse(missing.stdout);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not ready/);
    expect(body.error).not.toMatch(/Errno 2/);
    await mkdir(join(root, 'obu'));
    await writeFile(join(root, 'obu', 'active.json'), '{');
    const broken = await runBridge(root, { engine: 'browser', action: 'tabs' });
    expect(JSON.parse(broken.stdout).error).toMatch(/unreadable/);
    await writeFile(join(root, 'obu', 'active.json'), JSON.stringify({ socketPath: join(root, 'obu', 'missing.sock') }));
    const socketGone = await runBridge(root, { engine: 'browser', action: 'tabs' });
    const gone = JSON.parse(socketGone.stdout);
    expect(gone.ok).toBe(false);
    expect(gone.error).toMatch(/socket is missing/);
    expect(gone.error).not.toMatch(/Errno 2/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
