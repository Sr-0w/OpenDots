/** Real XFCE/Chromium/X11/noVNC test. Does not call a paid model or public site. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { WebSocket } from 'ws';
import { chromium } from 'playwright';
const dir = await mkdtemp(join(tmpdir(), 'opendots-desktop-smoke-'));
process.env.OPENDOTS_DATA_DIR = dir;
const { authStore, closeAuthStore, registerUser, createSession } = await import('../src/auth/store.ts');
const { withAccount } = await import('../src/auth/context.ts');
const { openDatabase, closeAllDatabases } = await import('../src/db/client.ts');
const { setSetting, setOpenRouterKey } = await import('../src/settings.ts');
const { createAgent, getAgent, mainConversationId, updateAgent } = await import('../src/agents/repo.ts');
const { buildCapabilityTools } = await import('../src/agents/capability-tools.ts');
const { resolveApproval } = await import('../src/approvals/service.ts');
const { createApplication } = await import('../src/app.ts');
const { attachDesktopWebSocket } = await import('../src/computer/websocket.ts');
const { startDesktop, screenshot, readScreenshot, desktopAction, desktopExec, removeDesktop, setHumanControl, desktopStatus } = await import('../src/computer/desktop.ts');
await authStore(true);
const a = await registerUser('alice@example.com', 'desktop smoke password');
const b = await registerUser('bob@example.com', 'desktop smoke password');
let cookieA = `opendots_session=${await createSession(a.id)}`, cookieB = `opendots_session=${await createSession(b.id)}`;
const activate = async () => { await openDatabase({ memory: true }); };
for (const account of [a, b]) await withAccount(account, activate);
const app = createApplication(activate), server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
const closeSockets = attachDesktopWebSocket(server as import('node:http').Server, activate);
await new Promise<void>((resolve) => server.listening ? resolve() : server.once('listening', resolve));
const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
const request = (path: string, cookie = cookieA, method = 'GET', body?: unknown) => fetch(`${origin}/api${path}`, { method, headers: { cookie, origin, 'x-opendots-client': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const asA = <T>(fn: () => T) => withAccount(a, fn);
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
async function until<T>(read: () => Promise<T>, test: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < 60; i++) { last = await read(); if (test(last)) return last; await pause(); }
  throw new Error(`État attendu non atteint : ${String(last).slice(0, 200)}`);
}
async function rejectedSocket(cookie?: string, from = origin) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/computer/vnc', { headers: { ...(cookie ? { cookie } : {}), origin: from } });
  ws.on('error', () => {});
  const result = await new Promise<number>((resolve, reject) => { ws.once('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode!); }); ws.once('open', () => { ws.close(); reject(new Error('WebSocket accepté à tort')); }); });
  ws.terminate(); return result;
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  assert.equal((await request('/computer/desktop', '')).status, 401);
  assert.equal(await rejectedSocket(), 401); assert.equal(await rejectedSocket(cookieA, 'https://evil.example'), 403);
  assert.equal(await rejectedSocket(cookieB), 409);
  console.log('PASS API et WebSocket privés, origine tierce et bureau désactivé refusés.');
  await asA(async () => { await setSetting('desktop.config', { enabled: true }); await startDesktop(); });
  assert.equal((await asA(desktopStatus)).running, true);
  await until(
    () => asA(async () => (await desktopExec(['sh', '-c', 'cat /tmp/wallpaper.log 2>/dev/null || true'])).toString()),
    (value) => value.includes('Wallpaper ready:'),
  );
  const wallpaper = JSON.parse((await asA(() => desktopExec(['sh', '-c', `export DBUS_SESSION_BUS_ADDRESS="$(cat /tmp/runtime-opendots/session-bus)"
python3 - <<'PY'
import runpy, tempfile, json
from pathlib import Path
from PIL import Image, ImageStat
module = runpy.run_path('/usr/local/bin/opendots-wallpaper')
assert module['frame_at'](0) == module['frame_at'](24)
for hour in [0, 6, 9, 13, 18, 22]:
    first, second, weight = module['frame_at'](hour)
    assert 0 <= weight <= 1
cache = Path.home()/'.cache/opendots-wallpaper'
night, day = cache/'wallpaper-0.png', cache/'wallpaper-1.png'
module['render'](0, night)
module['render'](13, day)
with Image.open(night) as n, Image.open(day) as d:
    assert n.size == d.size == (1280, 800)
    assert ImageStat.Stat(d).mean[0] > ImageStat.Stat(n).mean[0] + 20
assert module['apply'](night)
targets = [p for p in module['query']('-l').splitlines() if p.endswith('/last-image')]
assert targets and all(module['query']('-p', p).strip() == str(night) for p in targets)
assert module['apply'](day)
assert all(module['query']('-p', p).strip() == str(day) for p in targets)
assert len(list(cache.glob('*.png'))) <= 2
print(json.dumps({'phases':6, 'targets':len(targets), 'files':2}))
PY`]))).toString());
  assert.equal(wallpaper.phases, 6); assert(wallpaper.targets >= 1); assert.equal(wallpaper.files, 2);
  console.log('PASS fond dynamique : six étapes jour/nuit, transition à minuit, images originales, application XFCE réelle et cache borné.');
  // Load a controlled offline page. Its title records real browser events.
  await asA(() => desktopExec(['python3', '-c', `from pathlib import Path
Path('/home/opendots/fixture.html').write_text('''<!doctype html><meta charset="utf-8"><title>OpenDots GUI fixture</title><style>body{height:3000px;background:#fafafa;font:20px sans-serif}textarea{position:fixed;left:40px;top:40px;width:600px;height:100px}button{position:fixed;left:40px;top:240px;width:300px;height:80px;background:rgb(11,203,79);border:0}</style><textarea autofocus oninput="document.title='Typed:'+this.value"></textarea><button onclick="document.title='Clicked'">Vérifier le clic</button><script>onscroll=()=>document.title='Scrolled:'+scrollY</script>''',encoding='utf-8')`]));
  await asA(() => desktopAction({ action: 'key', key: 'ctrl+l' }));
  await asA(() => desktopAction({ action: 'type', text: 'file:///home/opendots/fixture.html' }));
  await asA(() => desktopAction({ action: 'key', key: 'Return' }));
  const title = async () => asA(async () => (await desktopExec(['sh', '-c', 'xdotool getactivewindow getwindowname'])).toString());
  await until(title, (value) => value.includes('OpenDots GUI fixture'));
  await asA(() => desktopAction({ action: 'type', text: 'Bonjour énergie ✓' }));
  await until(title, (value) => value.includes('Typed:Bonjour énergie ✓'));
  // Identify a target by its actual pixels, then click in desktop coordinates.
  const position = JSON.parse((await asA(() => desktopExec(['python3', '-c', `from PIL import ImageGrab
import json
im=ImageGrab.grab(xdisplay=':99').convert('RGB')
p=[(x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))==(11,203,79)]
assert p, 'Bouton non visible'
print(json.dumps({'x':sum(v[0] for v in p)//len(p),'y':sum(v[1] for v in p)//len(p)}))`]))).toString());
  await asA(() => desktopAction({ action: 'click', ...position }));
  await until(title, (value) => value.includes('Clicked'));
  await asA(() => desktopAction({ action: 'scroll', direction: 'down', amount: 4, x: 700, y: 600 }));
  await until(title, (value) => /Scrolled:[1-9]/.test(value));
  console.log('PASS Chromium réel : saisie Unicode, touches, cible identifiée dans les pixels, clic et défilement.');
  const shot = await asA(screenshot), bytes = (await asA(() => readScreenshot(shot.screenshotId)))!;
  assert.equal(bytes.readUInt32BE(16), 1280); assert.equal(bytes.readUInt32BE(20), 800);
  assert.equal((await request(shot.url.replace('/api', ''))).status, 200);
  assert.equal((await request(shot.url.replace('/api', ''), cookieB)).status, 404);
  await writeFile('/tmp/opendots-desktop-capture.png', bytes);
  await asA(async () => {
    const created = await createAgent({ name: 'Vision', permissions: { computer: true } });
    const ctx = { agent: (await getAgent(created.id))!, conversationId: await mainConversationId(created.id), userTurn: true, isMain: true, depth: 0, tz: 'UTC' };
    const tools = (await buildCapabilityTools(ctx)).tools;
    const output: any = await tools.computer_screenshot.execute!({}, { toolCallId: 'screen', messages: [] } as any);
    const modelOutput = await tools.computer_screenshot.toModelOutput!({ toolCallId: 'screen', input: {}, output });
    assert.equal(modelOutput.type, 'content'); assert((modelOutput as any).value.some((p: any) => p.type === 'file' && p.mediaType === 'image/png'));
    const pointer = async () => (await desktopExec(['xdotool', 'getmouselocation', '--shell'])).toString();
    const before = await pointer();
    const prepare = () => tools.computer_action.execute!({ action: { action: 'move', x: 444, y: 333 }, reason: 'Déplacer le pointeur de test' }, { toolCallId: 'move', messages: [] } as any) as Promise<any>;
    const pending = await prepare(); assert.equal(pending.status, 'pending_approval'); assert.equal(await pointer(), before);
    assert.equal((await resolveApproval(pending.approvalId, 'approve', { by: 'ui', notifyAgent: false })).status, 'executed');
    assert((await pointer()).includes('X=444\nY=333'));
    await assert.rejects(() => resolveApproval(pending.approvalId, 'approve', { by: 'ui', notifyAgent: false }));
    const refused = await prepare(); assert.equal((await resolveApproval(refused.approvalId, 'reject', { by: 'ui', notifyAgent: false })).status, 'rejected');
    const revoked = await prepare(); await updateAgent(created.id, { permissions: { ...ctx.agent.permissions, computer: false } });
    assert.equal((await resolveApproval(revoked.approvalId, 'approve', { by: 'ui', notifyAgent: false })).status, 'failed');
    await setHumanControl(true); await assert.rejects(screenshot, /pris la main/); await assert.rejects(() => desktopAction({ action: 'key', key: 'Return' }), /pris la main/); await setHumanControl(false);
    await setSetting('onboarding.done', true); await setOpenRouterKey('desktop-fixture-personal-key'); await setSetting('models.default', { provider: 'openrouter', model: 'fixture/vision' });
  });
  console.log('PASS PNG réel vers le modèle, captures privées, approbation obligatoire, refus, anti-rejeu, retrait de permission et reprise manuelle.');
  // A second real container gets a separate profile and filesystem.
  await asA(() => desktopExec(['sh', '-c', 'printf alice > /home/opendots/private-alice.txt']));
  await withAccount(b, async () => {
    await setSetting('desktop.config', { enabled: true }); await startDesktop();
    assert.equal((await desktopExec(['sh', '-c', 'test ! -e /home/opendots/private-alice.txt && echo isolated'])).toString().trim(), 'isolated');
  });
  console.log('PASS deux conteneurs réels : fichiers et profils isolés entre comptes.');
  if (process.env.OPENDOTS_DESKTOP_LIVE_WEB === '1') {
    await asA(() => desktopAction({ action: 'key', key: 'ctrl+l' }));
    await asA(() => desktopAction({ action: 'type', text: 'https://example.com' }));
    await asA(() => desktopAction({ action: 'key', key: 'Return' }));
    await until(title, (value) => value.includes('Example Domain'));
    console.log('PASS Chromium : page HTTPS réelle via le proxy et les certificats, sans désactiver TLS.');
  }
  browser = await chromium.launch({ executablePath: process.env.OPENDOTS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ locale: 'fr-BE', viewport: { width: 1440, height: 1080 } });
  await context.addCookies([{ name: 'opendots_session', value: cookieA.split('=')[1], url: origin }]);
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/#computer`);
  const takeOver = page.getByRole('button', { name: 'Prendre la main', exact: true });
  await takeOver.click({ timeout: 30_000 });
  await page.getByText('Tu contrôles le bureau. Les captures et actions des modèles sont suspendues.', { exact: true }).waitFor();
  const canvas = page.locator('[aria-label="Bureau distant"] canvas');
  assert.equal(await canvas.evaluate((element: HTMLCanvasElement) => element.width), 1280);
  await asA(() => assert.rejects(screenshot, /pris la main/));
  await page.getByRole('button', { name: 'Rendre la main aux modèles', exact: true }).click();
  await page.getByText('Vue seule. Chaque action des modèles attend une validation humaine.', { exact: true }).waitFor();
  await asA(screenshot);
  await page.screenshot({ path: '/tmp/opendots-desktop-ui.png', fullPage: true });
  assert.deepEqual(errors, []);
  // An established websocket must be revoked immediately on logout.
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/computer/vnc', { headers: { cookie: cookieA, origin } });
  await once(ws, 'open'); const closed = once(ws, 'close');
  assert.equal((await request('/auth/logout', cookieA, 'POST', {})).status, 200); await closed;
  assert.equal(await rejectedSocket(cookieA), 401);
  cookieA = `opendots_session=${await createSession(a.id)}`;
  assert.equal((await request('/settings', cookieA, 'PUT', { shell: { network: false } })).status, 200);
  assert.equal((await asA(desktopStatus)).running, false);
  console.log('PASS arrêt du conteneur quand le réseau de l’ordinateur est désactivé.');
  console.log('PASS noVNC dans Chromium : canvas 1280×800, reprise manuelle et WebSocket révoqué à la déconnexion.');
} catch (error) {
  try {
    await writeFile('/tmp/opendots-desktop-failure.png', await asA(() => desktopExec(['python3', '-c', 'from PIL import ImageGrab; import sys; ImageGrab.grab(xdisplay=":99").save(sys.stdout.buffer,"PNG")'])));
  } catch { /* The container may have failed before X11 was available. */ }
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close(); closeSockets(); await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const account of [a, b]) await withAccount(account, removeDesktop).catch(() => {});
  await closeAllDatabases(); await closeAuthStore(); await rm(dir, { recursive: true, force: true });
}
