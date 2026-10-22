import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { config } from '../config.ts';
import { accountKey } from '../auth/context.ts';
import { BUILTIN_COMPUTER_IMAGE, getSetting, getShellSettings, getTimezone, setSetting } from '../settings.ts';
import { computerName, computerState, dockerAvailable, ensureContainer, ensureComputerUser, ensureImage, leaseComputer, linuxUser } from './shell.ts';
import { KeyedMutex } from '../util.ts';
import { desktopAgentId, desktopKey, withDesktopAgent, computerSlot } from './session.ts';
import { getAgent, listAgentRows } from '../agents/repo.ts';

export const DESKTOP_IMAGE = BUILTIN_COMPUTER_IMAGE;
export const WIDTH = 1280, HEIGHT = 800;
const run = promisify(execFile);
const starting = new Map<string, Promise<number>>();
const typing = new Map<string, AbortController>();
const actions = new KeyedMutex(), allocation = new KeyedMutex();
export class DesktopError extends Error {}
const settingKey = () => `desktop.bot.${desktopAgentId()}` as const;
export const humanControl = async () => (await getSetting(settingKey()))?.manualControl === true;
export async function setHumanControl(enabled: boolean) {
  if (enabled) typing.get(desktopKey())?.abort(new DesktopError('L’utilisateur a pris la main. Saisie interrompue.'));
  const current = await getSetting(settingKey());
  await setSetting(settingKey(), { ...current, enabled: current?.enabled ?? await desktopEnabled(), manualControl: enabled });
}
async function assertModelControl() { if (await humanControl()) throw new DesktopError('L’utilisateur a pris la main. Captures et actions des modèles suspendues.'); }
export const desktopEnabled = async () => {
  const agent = await getAgent(desktopAgentId());
  if (!agent || agent.archived || !agent.permissions.computer) return false;
  return (await getSetting(settingKey()))?.enabled ?? agent.permissions.computer;
};
export async function buildDesktopImage(force = false) {
  // The account's one image contains both shell and independent desktop sessions.
  await ensureImage(DESKTOP_IMAGE, force);
}
async function session() {
  return allocation.run(accountKey(), async () => {
    const saved = await getSetting(settingKey());
    if (saved?.slot && saved.password) return saved as typeof saved & { slot: number; password: string };
    const slot = await computerSlot(desktopAgentId());
    const value = { ...saved, enabled: saved?.enabled ?? await desktopEnabled(), slot, password: randomBytes(6).toString('base64') };
    await setSetting(settingKey(), value);
    return value;
  });
}
export async function desktopStatus() {
  const available = await dockerAvailable();
  const state = available ? await computerState() : null;
  const saved = await getSetting(settingKey());
  const running = Boolean(state?.running && saved?.runtimeId === state.generation);
  return { agentId: desktopAgentId(), enabled: await desktopEnabled(), manualControl: await humanControl(), available, running, restartRequired: Boolean(saved?.runtimeId && state && saved.runtimeId !== state.generation), suspended: state?.paused ?? false, width: WIDTH, height: HEIGHT, ...(running ? { vncPassword: saved?.password } : {}) };
}
export async function startDesktop(): Promise<number> {
  if (!await desktopEnabled()) throw new DesktopError('Active le bureau de ce compagnon depuis la page Ordinateur.');
  const settings = await getShellSettings();
  if (settings.mode === 'off' || !settings.network) throw new DesktopError('Active l’ordinateur et son réseau pour utiliser le bureau.');
  const key = desktopKey();
  if (starting.has(key)) return starting.get(key)!;
  const pending = (async () => {
    const release = leaseComputer();
    try {
      await ensureContainer(settings);
      if (!await desktopEnabled()) throw new DesktopError('Démarrage du bureau annulé.');
      const bot = await session();
      const { user } = await ensureComputerUser(desktopAgentId(), settings.sudo);
      const payload = JSON.stringify({ password: bot.password, timezone: await getTimezone(), wallpaper: process.env.OPENDOTS_DESKTOP_WALLPAPER === 'off' ? 'off' : 'dynamic' });
      let launched = false;
      await new Promise<void>((resolve, reject) => {
        const child = spawn('docker', ['exec', '-i', computerName(), 'python3', '/usr/local/bin/opendots-bot-session', 'start', user, String(bot.slot)], { stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdout.on('data', (data) => { if (data.toString().includes('started')) launched = true; });
        let error = ''; child.stderr.on('data', (data) => { error = (error + data).slice(-500); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new DesktopError(`Le bureau ne démarre pas : ${error}`)); });
        child.stdin.on('error', () => {}); child.stdin.end(payload);
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (!await desktopEnabled()) throw new DesktopError('Démarrage du bureau annulé.');
        try {
          await desktopExec(launched ? ['sh', '-c', 'xdotool getdisplaygeometry && xdotool search --onlyvisible --class xfdesktop'] : ['xdotool', 'getdisplaygeometry']);
          if (!await desktopEnabled()) throw new DesktopError('Démarrage du bureau annulé.');
          const state = await computerState();
          const current = await getSetting(settingKey());
          await setSetting(settingKey(), { ...current, enabled: current?.enabled ?? true, runtimeId: state?.generation });
          return 5900 + bot.slot;
        } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      }
      throw new DesktopError('Le bureau ne démarre pas. Consulte les logs de sa session dans son dossier personnel.');
    } finally { release(); }
  })();
  starting.set(key, pending);
  try { return await pending; } finally { starting.delete(key); }
}
export async function stopDesktop() {
  typing.get(desktopKey())?.abort(new DesktopError('Bureau arrêté. Saisie interrompue.'));
  const saved = await getSetting(settingKey());
  await setSetting(settingKey(), { ...saved, enabled: false, manualControl: false, runtimeId: undefined });
  await starting.get(desktopKey())?.catch(() => {});
  const state = await computerState();
  if (!state?.running || !saved?.slot) return;
  const release = leaseComputer();
  try {
    if (state.paused) await run('docker', ['unpause', computerName()], { timeout: 15_000 });
    await run('docker', ['exec', computerName(), 'python3', '/usr/local/bin/opendots-bot-session', 'stop', linuxUser(desktopAgentId()), String(saved.slot)], { timeout: 15_000 });
  } finally { release(); }
}
// Removes the running session only; homes and browser profiles persist.
export const removeDesktop = stopDesktop;
export async function desktopExec(args: string[], input?: string, options: { signal?: AbortSignal; keepStdinOpen?: boolean; timeoutMs?: number } = {}): Promise<Buffer> {
  options.signal?.throwIfAborted();
  const bot = await session();
  const user = linuxUser(desktopAgentId()), home = `/workspaces/${desktopAgentId()}`;
  const release = leaseComputer();
  try {
    await ensureContainer();
    options.signal?.throwIfAborted();
    return await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', user, '-e', `DISPLAY=:${bot.slot}`, '-e', `XAUTHORITY=${home}/.Xauthority`, '-e', `HOME=${home}`, '-e', `XDG_RUNTIME_DIR=/tmp/runtime-${user}`, computerName(), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let size = 0, error = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { child.stdin.end(); killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1500); };
    const timer = setTimeout(cancel, options.timeoutMs ?? 15_000);
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', cancel); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (part: Buffer) => { size += part.length; if (size > 8_000_000) child.kill('SIGKILL'); else chunks.push(part); });
    child.stderr.on('data', (part) => { error = (error + part).slice(-1000); });
    child.on('error', (e) => { cleanup(); reject(e); });
    child.on('close', (code) => { cleanup(); if (options.signal?.aborted) { reject(options.signal.reason); return; } code === 0 && size <= 8_000_000 ? resolve(Buffer.concat(chunks)) : reject(new DesktopError(`Opération du bureau impossible (${code ?? 'timeout'}). ${error.slice(-400)}`)); });
    child.stdin.on('error', () => {}); if (options.keepStdinOpen) child.stdin.write(input ?? ''); else child.stdin.end(input);
    if (options.signal?.aborted) cancel();
  }); } finally { release(); }
}
export function desktopVncStream(port: number) {
  return spawn('docker', ['exec', '-i', computerName(), 'socat', 'STDIO', `TCP:127.0.0.1:${port}`], { stdio: ['pipe', 'pipe', 'pipe'] });
}
const point = { x: z.number().int().min(0).max(WIDTH - 1), y: z.number().int().min(0).max(HEIGHT - 1) };
export const desktopActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), ...point, button: z.enum(['left', 'middle', 'right']).default('left'), double: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('type'), text: z.string().min(1).max(2000).regex(/^[^\x00-\x1f\x7f]*$/, 'Texte imprimable uniquement : utilise key Return ou Tab explicitement, sans retour à la ligne caché dans text.'), submit: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('key'), key: z.enum(['Return', 'Tab', 'Escape', 'BackSpace', 'Delete', 'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'Page_Up', 'Page_Down', 'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+l', 'ctrl+t', 'ctrl+w', 'ctrl+s', 'alt+Left', 'alt+F4', 'shift+Tab']) }).strict(),
  z.object({ action: z.literal('scroll'), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(20).default(3), ...point }).strict(),
  z.object({ action: z.literal('move'), ...point }).strict(),
]);
export type DesktopAction = z.infer<typeof desktopActionSchema>;
export async function semanticOperation(input: { engine: 'native' | 'browser'; action: string; [key: string]: unknown }, signal?: AbortSignal) {
  return actions.run(desktopKey(), async () => {
    await assertModelControl(); signal?.throwIfAborted();
    await startDesktop(); await assertModelControl();
    const controller = new AbortController(); typing.set(desktopKey(), controller);
    const abort = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      if (input.engine === 'browser' && input.action === 'open') {
        const running = await desktopExec(['sh', '-c', 'pgrep -u "$(id -u)" -x chromium || true']);
        if (!running.toString().trim()) await desktopExec(['opendots-open-browser', 'about:blank'], undefined, { signal: abort });
      }
      abort.throwIfAborted(); await assertModelControl();
      return JSON.parse((await desktopExec(['python3', '/usr/local/share/opendots/semantic-bridge.py'], JSON.stringify(input)+'\n', { signal: abort, keepStdinOpen: true, timeoutMs: 30_000 })).toString());
    } finally { if (typing.get(desktopKey()) === controller) typing.delete(desktopKey()); }
  });
}
export async function desktopAction(input: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const action = desktopActionSchema.parse(input);
  return actions.run(desktopKey(), async () => {
    await assertModelControl();
    signal?.throwIfAborted();
    await startDesktop();
    await assertModelControl();
    signal?.throwIfAborted();
    if ('x' in action) {
      const controller = new AbortController(); typing.set(desktopKey(), controller);
      const abort = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        await desktopExec(['python3', '/usr/local/share/opendots/cursor-motion.py', String(action.x), String(action.y)], undefined, { signal: abort, keepStdinOpen: true });
        abort.throwIfAborted(); await assertModelControl();
      } finally { if (typing.get(desktopKey()) === controller) typing.delete(desktopKey()); }
    }
    switch (action.action) {
      case 'click': await desktopExec(['xdotool', 'click', '--clearmodifiers', '--repeat', action.double ? '2' : '1', String({ left: 1, middle: 2, right: 3 }[action.button])]); break;
      case 'move': break;
      case 'type': {
        const controller = new AbortController(); typing.set(desktopKey(), controller);
        const abort = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        try {
          await desktopExec(['python3', '-c', await readFile(new URL('./type.py', import.meta.url), 'utf8')], JSON.stringify({ text: action.text })+'\n', { signal: abort, keepStdinOpen: true, timeoutMs: 45_000 });
          abort.throwIfAborted(); await assertModelControl();
          if (action.submit) await desktopExec(['xdotool', 'key', '--clearmodifiers', 'Return']);
        } finally { if (typing.get(desktopKey()) === controller) typing.delete(desktopKey()); }
        break;
      }
      case 'key': await desktopExec(['xdotool', 'key', '--clearmodifiers', action.key]); break;
      case 'scroll': await desktopExec(['xdotool', 'click', '--clearmodifiers', '--repeat', String(action.amount), String({ up: 4, down: 5, left: 6, right: 7 }[action.direction])]); break;
    }
    return { ok: true, action: action.action, note: 'Action exécutée. Prends une nouvelle capture pour vérifier le résultat.' };
  });
}
export async function screenshot() {
  return actions.run(desktopKey(), async () => {
    await assertModelControl();
    await startDesktop();
    await assertModelControl();
    const capture = await desktopExec(['python3', '-c', await readFile(new URL('./capture.py', import.meta.url), 'utf8')]);
    const headerEnd = capture.indexOf(10);
    if (headerEnd < 0 || headerEnd > 8192) throw new DesktopError('Capture sans métadonnées valides.');
    const { cursor, frameHash, focusedWindow } = JSON.parse(capture.subarray(0, headerEnd).toString());
    const png = capture.subarray(headerEnd + 1);
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new DesktopError('Capture PNG invalide.');
    const dir = join(config.dataDir, 'desktops', desktopAgentId(), 'screenshots'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const files = await Promise.all((await readdir(dir)).filter((f) => /^[a-f0-9]{32}\.png$/.test(f)).map(async (file) => ({ file, time: (await stat(join(dir, file))).mtimeMs })));
    // Bound storage and retention of browser contents; ownership is the account directory.
    for (const file of files.sort((a, b) => b.time - a.time).slice(19)) await rm(join(dir, file.file), { force: true });
    const id = randomBytes(16).toString('hex'); await writeFile(join(dir, `${id}.png`), png, { mode: 0o600 });
    return { ok: true as const, screenshotId: id, width: WIDTH, height: HEIGHT, cursor: cursor as { x: number; y: number } | null, frameHash: frameHash as string, focusedWindow: focusedWindow as { id: string; title: string; wmClass: string | null; geometry: { x: number; y: number; width: number; height: number } } | null, url: `/api/computer/screenshots/${id}?agentId=${desktopAgentId()}`, capturedAt: new Date().toISOString() };
  });
}
export async function readScreenshot(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try { return await readFile(join(config.dataDir, 'desktops', desktopAgentId(), 'screenshots', `${id}.png`)); } catch { return null; }
}

export async function stopAllDesktops() {
  for (const agent of await listAgentRows()) await withDesktopAgent(agent.id, stopDesktop);
}
