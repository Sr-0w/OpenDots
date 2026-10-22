import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { config, repoRoot, systemDataDir } from '../config.ts';
import { accountKey } from '../auth/context.ts';
import { getSetting, getShellSettings, getTimezone, setSetting } from '../settings.ts';
import { dockerAvailable } from './shell.ts';
import { KeyedMutex } from '../util.ts';

export const DESKTOP_IMAGE = 'opendots/desktop:2';
export const WIDTH = 1280, HEIGHT = 800;
const run = promisify(execFile);
const name = () => `opendots-desktop-${createHash('sha256').update(`${systemDataDir}:${accountKey()}`).digest('hex').slice(0, 16)}`;
const starting = new Map<string, Promise<number>>();
const actions = new KeyedMutex();
export const humanControl = async () => (await getSetting('desktop.config'))?.manualControl === true;
export async function setHumanControl(enabled: boolean) { const current = await getSetting('desktop.config'); await setSetting('desktop.config', { enabled: current?.enabled ?? false, manualControl: enabled }); }
async function assertModelControl() { if (await humanControl()) throw new DesktopError('L’utilisateur a pris la main. Captures et actions des modèles suspendues.'); }
let building: Promise<void> | undefined;
export class DesktopError extends Error {}
export const desktopEnabled = async () => (await getSetting('desktop.config'))?.enabled === true;
const docker = (args: string[], timeout = 30_000) => run('docker', args, { timeout, maxBuffer: 8_000_000 });

async function trust() {
  const dir = join(systemDataDir, 'desktop-build');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const system = await readFile(process.env.SSL_CERT_FILE ?? '/etc/ssl/certs/ca-certificates.crt', 'utf8');
  const proxy = process.env.CODEX_PROXY_CERT ? await readFile(process.env.CODEX_PROXY_CERT, 'utf8') : '';
  if ((system + proxy).includes('PRIVATE KEY') || !system.includes('BEGIN CERTIFICATE')) throw new DesktopError('Certificats TLS invalides.');
  const bundle = join(dir, 'ca.pem');
  await writeFile(bundle, system + '\n' + proxy, { mode: 0o644 });
  await chmod(bundle, 0o644);
  const proxyFile = join(dir, 'proxy.crt');
  if (proxy) { await writeFile(proxyFile, proxy, { mode: 0o644 }); await chmod(proxyFile, 0o644); }
  return { bundle, proxyFile: proxy ? proxyFile : undefined };
}
async function proxyArgs() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  const extra: string[] = [];
  if (proxy) {
    const host = new URL(proxy).hostname;
    const { address } = await lookup(host);
    extra.push('--add-host', `${host}:${address}`);
  }
  return { proxy, extra };
}
export async function buildDesktopImage(force = false) {
  if (!await dockerAvailable()) throw new DesktopError('Docker est nécessaire pour le bureau graphique.');
  if (!force) try { await docker(['image', 'inspect', DESKTOP_IMAGE]); return; } catch { /* build once */ }
  building ??= (async () => {
    const ca = await trust(), network = await proxyArgs();
    const args = ['build', ...network.extra, '--secret', `id=opendots_ca,src=${ca.bundle}`, ...(network.proxy ? ['--build-arg', `http_proxy=${network.proxy}`, '--build-arg', `https_proxy=${network.proxy}`] : []), '-t', DESKTOP_IMAGE, join(repoRoot, 'apps/server/computer')];
    try { await docker(args, 600_000); }
    catch { throw new DesktopError('Construction du bureau impossible. Vérifie Docker, l’accès aux dépôts Debian et les certificats du proxy.'); }
  })();
  try { await building; } finally { building = undefined; }
}
async function inspect() {
  try {
    const { stdout } = await docker(['inspect', name()]);
    const value = JSON.parse(stdout)[0];
    if (value.Config.Labels?.['opendots.desktop.owner'] !== `${systemDataDir}:${accountKey()}`) throw new DesktopError('Nom de conteneur déjà utilisé.');
    return value;
  } catch (error) { if (error instanceof DesktopError) throw error; return null; }
}
/** Arguments `docker run` du bureau. Montages en `-v` pour porter les étiquettes SELinux. */
export function desktopRunArgs(o: { name: string; owner: string; home: string; proxy?: string | null; extra: string[]; proxyCa?: string | null; memory?: string; cpus?: string; revision?: string; timezone?: string; wallpaper?: string }) {
  for (const path of [o.home, o.proxyCa].filter(Boolean) as string[]) if (/[:,]/.test(path)) throw new DesktopError('Chemin de montage invalide pour le bureau.');
  const proxy = o.proxy ? ['-e', `HTTPS_PROXY=${o.proxy}`, '-e', `HTTP_PROXY=${o.proxy}`, '-e', `https_proxy=${o.proxy}`, '-e', `http_proxy=${o.proxy}`] : [];
  return ['run', '-d', '--name', o.name, '--label', `opendots.desktop.owner=${o.owner}`, ...(o.revision ? ['--label', `opendots.desktop.config=${o.revision}`] : []), '-e', `TZ=${o.timezone ?? 'UTC'}`, '-e', `OPENDOTS_DESKTOP_WALLPAPER=${o.wallpaper ?? 'dynamic'}`, '--restart', 'unless-stopped', '--memory', o.memory ?? process.env.OPENDOTS_DESKTOP_MEMORY ?? '2g', '--cpus', o.cpus ?? process.env.OPENDOTS_DESKTOP_CPUS ?? '2', '--pids-limit', '512', '--shm-size', '256m', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--security-opt', 'no-new-privileges', '-p', '127.0.0.1::5900',
    // :Z — dossier privé à ce conteneur ; :ro,z — certificat partagé en lecture seule (SELinux enforcing).
    '-v', `${o.home}:/home/opendots:Z`, ...o.extra, ...proxy, ...(o.proxyCa ? ['-v', `${o.proxyCa}:/usr/local/share/ca-certificates/opendots-proxy.crt:ro,z`] : []), DESKTOP_IMAGE];
}

/** Attend que le conteneur tourne vraiment ; signale une boucle de redémarrage. */
async function runningState() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const state = await inspect();
    if (state?.State.Running && !state.State.Restarting && state.NetworkSettings.Ports?.['5900/tcp']?.length) return state;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const state = await inspect();
  if (!state) throw new DesktopError('Le conteneur du bureau a disparu au démarrage.');
  if (state.State.Restarting || !state.State.Running) throw new DesktopError(`Le conteneur du bureau redémarre en boucle (${state.RestartCount ?? 0} redémarrage(s)${state.State.Error ? ` : ${String(state.State.Error).slice(0, 160)}` : ''}). Consulte ses logs : docker logs ${name()}`);
  return state;
}

export async function desktopStatus() {
  const available = await dockerAvailable();
  const state = available ? await inspect() : null;
  return { enabled: await desktopEnabled(), manualControl: await humanControl(), available, running: Boolean(state?.State.Running), width: WIDTH, height: HEIGHT };
}
export async function startDesktop(): Promise<number> {
  if (!await desktopEnabled()) throw new DesktopError('Active le bureau depuis la page Ordinateur.');
  const settings = await getShellSettings();
  if (settings.mode === 'off') throw new DesktopError('L’ordinateur est désactivé dans les paramètres.');
  // A network-disabled Docker container cannot expose a loopback VNC mapping.
  if (!settings.network) throw new DesktopError('Active le réseau de l’ordinateur pour utiliser le bureau graphique.');
  const key = accountKey();
  if (starting.has(key)) return starting.get(key)!;
  const pending = (async () => {
    await buildDesktopImage();
    const latest = await getShellSettings();
    if (!await desktopEnabled() || latest.mode === 'off' || !latest.network) throw new DesktopError('Démarrage du bureau annulé.');
    const timezone = await getTimezone();
    const wallpaper = process.env.OPENDOTS_DESKTOP_WALLPAPER === 'off' ? 'off' : 'dynamic';
    const revision = `${timezone}:${wallpaper}:${process.env.OPENDOTS_DESKTOP_MEMORY ?? '2g'}:${process.env.OPENDOTS_DESKTOP_CPUS ?? '2'}`;
    let state = await inspect();
    const image = (await docker(['image', 'inspect', '--format', '{{.Id}}', DESKTOP_IMAGE])).stdout.trim();
    if (state && (state.Image !== image || state.Config.Labels?.['opendots.desktop.config'] !== revision)) { await docker(['rm', '-f', name()]); state = null; }
    const launched = !state?.State.Running;
    if (!state) {
      const home = join(config.dataDir, 'desktop');
      await mkdir(home, { recursive: true, mode: 0o700 });
      const network = await proxyArgs(), ca = await trust();
      await docker(desktopRunArgs({ name: name(), owner: `${systemDataDir}:${accountKey()}`, home, proxy: network.proxy, extra: network.extra, proxyCa: ca.proxyFile, revision, timezone, wallpaper }));
    } else if (!state.State.Running) await docker(['start', name()]);
    state = await runningState();
    const binding = state.NetworkSettings.Ports['5900/tcp']?.find((p: any) => p.HostIp === '127.0.0.1');
    if (!binding) throw new DesktopError('Le bureau ne dispose pas de port privé.');
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await desktopExec(launched ? ['sh', '-c', 'xdotool getdisplaygeometry && xdotool search --onlyvisible --class chromium'] : ['xdotool', 'getdisplaygeometry']); return Number(binding.HostPort); }
      catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
    }
    throw new DesktopError('Le bureau ne démarre pas. Consulte les logs de son conteneur Docker.');
  })();
  starting.set(key, pending);
  try { return await pending; } finally { starting.delete(key); }
}
export async function stopDesktop() {
  // Disable first: pending approvals and WebSocket reconnects must fail closed.
  await setHumanControl(false);
  await setSetting('desktop.config', { enabled: false });
  await starting.get(accountKey())?.catch(() => {});
  if (await inspect()) await docker(['stop', name()]);
}
export async function removeDesktop() {
  if (await inspect()) await docker(['rm', '-f', name()]);
}
export async function desktopExec(args: string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', '1000:1000', '-e', 'DISPLAY=:99', '-e', 'HOME=/home/opendots', name(), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let size = 0, error = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.stdout.on('data', (part: Buffer) => { size += part.length; if (size > 8_000_000) child.kill('SIGKILL'); else chunks.push(part); });
    child.stderr.on('data', (part) => { error = (error + part).slice(-2000); });
    child.on('error', () => { clearTimeout(timer); reject(new DesktopError('Commande du bureau indisponible.')); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 && size <= 8_000_000 ? resolve(Buffer.concat(chunks)) : reject(new DesktopError(`Opération du bureau impossible (${code ?? 'timeout'}). ${error.slice(-400)}`)); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
const point = { x: z.number().int().min(0).max(WIDTH - 1), y: z.number().int().min(0).max(HEIGHT - 1) };
export const desktopActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), ...point, button: z.enum(['left', 'middle', 'right']).default('left'), double: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('type'), text: z.string().min(1).max(20_000) }).strict(),
  z.object({ action: z.literal('key'), key: z.enum(['Return', 'Tab', 'Escape', 'BackSpace', 'Delete', 'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'Page_Up', 'Page_Down', 'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+l', 'ctrl+t', 'ctrl+w', 'ctrl+s', 'alt+Left', 'alt+F4', 'shift+Tab']) }).strict(),
  z.object({ action: z.literal('scroll'), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(20).default(3), ...point }).strict(),
  z.object({ action: z.literal('move'), ...point }).strict(),
]);
export type DesktopAction = z.infer<typeof desktopActionSchema>;
export async function desktopAction(input: unknown) {
  const action = desktopActionSchema.parse(input);
  return actions.run(accountKey(), async () => {
    await assertModelControl();
    await startDesktop();
    await assertModelControl();
    switch (action.action) {
      case 'click': await desktopExec(['xdotool', 'mousemove', '--sync', String(action.x), String(action.y), 'click', '--clearmodifiers', '--repeat', action.double ? '2' : '1', String({ left: 1, middle: 2, right: 3 }[action.button])]); break;
      case 'move': await desktopExec(['xdotool', 'mousemove', '--sync', String(action.x), String(action.y)]); break;
      case 'type': await desktopExec(['sh', '-c', 'xclip -selection clipboard -i >/dev/null 2>&1 && xdotool key --clearmodifiers ctrl+v'], action.text); break;
      case 'key': await desktopExec(['xdotool', 'key', '--clearmodifiers', action.key]); break;
      case 'scroll': await desktopExec(['xdotool', 'mousemove', '--sync', String(action.x), String(action.y), 'click', '--clearmodifiers', '--repeat', String(action.amount), String({ up: 4, down: 5, left: 6, right: 7 }[action.direction])]); break;
    }
    return { ok: true, action: action.action, note: 'Action exécutée. Prends une nouvelle capture pour vérifier le résultat.' };
  });
}
export async function screenshot() {
  return actions.run(accountKey(), async () => {
    await assertModelControl();
    await startDesktop();
    await assertModelControl();
    const png = await desktopExec(['python3', '-c', 'from PIL import ImageGrab; import sys; ImageGrab.grab(xdisplay=":99").save(sys.stdout.buffer,"PNG")']);
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new DesktopError('Capture PNG invalide.');
    const dir = join(config.dataDir, 'screenshots'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const files = await Promise.all((await readdir(dir)).filter((f) => /^[a-f0-9]{32}\.png$/.test(f)).map(async (file) => ({ file, time: (await stat(join(dir, file))).mtimeMs })));
    // Bound storage and retention of browser contents; ownership is the account directory.
    for (const file of files.sort((a, b) => b.time - a.time).slice(19)) await rm(join(dir, file.file), { force: true });
    const id = randomBytes(16).toString('hex'); await writeFile(join(dir, `${id}.png`), png, { mode: 0o600 });
    return { ok: true as const, screenshotId: id, width: WIDTH, height: HEIGHT, url: `/api/computer/screenshots/${id}`, capturedAt: new Date().toISOString() };
  });
}
export async function readScreenshot(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try { return await readFile(join(config.dataDir, 'screenshots', `${id}.png`)); } catch { return null; }
}
