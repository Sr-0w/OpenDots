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
const { withDesktopAgent } = await import('../src/computer/session.ts');
const { computerName, computerState, execShell } = await import('../src/computer/shell.ts');
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const run = promisify(execFile);
process.env.OPENDOTS_COMPUTER_IDLE_SECONDS = '2';
const { setDesktopPermissions } = await import('../src/computer/permissions.ts');
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
const botA = await withAccount(a, () => createAgent({ name: 'Vision', permissions: { computer: true } }));
const botC = await withAccount(a, () => createAgent({ name: 'Second', permissions: { computer: true } }));
const botB = await withAccount(b, () => createAgent({ name: 'Other', permissions: { computer: true } }));
const asA = <T>(fn: () => T) => withAccount(a, () => withDesktopAgent(botA.id, fn));
const asC = <T>(fn: () => T) => withAccount(a, () => withDesktopAgent(botC.id, fn));
const asB = <T>(fn: () => T) => withAccount(b, () => withDesktopAgent(botB.id, fn));
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
async function until<T>(read: () => Promise<T>, test: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < 60; i++) { last = await read(); if (test(last)) return last; await pause(); }
  throw new Error(`État attendu non atteint : ${String(last).slice(0, 200)}`);
}
async function rejectedSocket(cookie?: string, from = origin) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + `/api/computer/vnc?agentId=${botA.id}`, { headers: { ...(cookie ? { cookie } : {}), origin: from } });
  ws.on('error', () => {});
  const result = await new Promise<number>((resolve, reject) => { ws.once('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode!); }); ws.once('open', () => { ws.close(); reject(new Error('WebSocket accepté à tort')); }); });
  ws.terminate(); return result;
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  assert.equal((await request('/computer/desktop', '')).status, 401);
  assert.equal(await rejectedSocket(), 401); assert.equal(await rejectedSocket(cookieA, 'https://evil.example'), 403);
  assert.equal(await rejectedSocket(cookieB), 404);
  console.log('PASS API et WebSocket privés, origine tierce et bureau désactivé refusés.');
  await asA(async () => { await startDesktop(); });
  assert.equal((await asA(desktopStatus)).running, true);
  await until(
    () => asA(async () => (await desktopExec(['sh', '-c', 'cat "$HOME/.vnc/wallpaper.log" 2>/dev/null || true'])).toString()),
    (value) => value.includes('Wallpaper ready:'),
  );
  const wallpaper = JSON.parse((await asA(() => desktopExec(['sh', '-c', `export DBUS_SESSION_BUS_ADDRESS="$(cat $XDG_RUNTIME_DIR/session-bus)"
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
Path('/workspaces/${botA.id}/fixture.html').write_text('''<!doctype html><meta charset="utf-8"><title>OpenDots GUI fixture</title><style>body{height:3000px;background:#fafafa;font:20px sans-serif}textarea{position:fixed;left:40px;top:40px;width:600px;height:100px}button{position:fixed;left:40px;top:240px;width:300px;height:80px;background:rgb(11,203,79);border:0}</style><textarea autofocus oninput="document.title='Typed:'+this.value"></textarea><button onclick="document.title='Clicked'">Vérifier le clic</button><script>onscroll=()=>document.title='Scrolled:'+scrollY</script>''',encoding='utf-8')`]));
  await asA(() => desktopAction({ action: 'key', key: 'ctrl+l' }));
  await asA(() => desktopAction({ action: 'type', text: `file:///workspaces/${botA.id}/fixture.html`, submit: true }));
  const title = async () => asA(async () => (await desktopExec(['sh', '-c', 'xdotool getactivewindow getwindowname 2>/dev/null || true'])).toString());
  await until(title, (value) => value.includes('OpenDots GUI fixture'));
  await asA(() => desktopAction({ action: 'type', text: 'Bonjour énergie ✓' }));
  await until(title, (value) => value.includes('Typed:Bonjour énergie ✓'));
  // Identify a target by its actual pixels, then click in desktop coordinates.
  const position = JSON.parse((await asA(() => desktopExec(['python3', '-c', `from PIL import ImageGrab
import json
im=ImageGrab.grab(xdisplay=__import__('os').environ['DISPLAY']).convert('RGB')
p=[(x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))==(11,203,79)]
assert p, 'Bouton non visible'
print(json.dumps({'x':sum(v[0] for v in p)//len(p),'y':sum(v[1] for v in p)//len(p)}))`]))).toString());
  await asA(() => desktopAction({ action: 'click', ...position }));
  await until(title, (value) => value.includes('Clicked'));
  await asA(() => desktopAction({ action: 'scroll', direction: 'down', amount: 4, x: 700, y: 600 }));
  await until(title, (value) => /Scrolled:[1-9]/.test(value));
  console.log('PASS Chromium réel : saisie Unicode, touches, cible identifiée dans les pixels, clic et défilement.');
  await asA(() => desktopExec(['python3', '-c', `from pathlib import Path
import os
(Path.home()/'form.html').write_text("""<title>Form test</title><form onsubmit='document.title="Submitted";return false'><input id=a autofocus oninput='document.title="First:"+this.value'><input id=b><button>Submit</button></form>""")`]));
  const formUrl = `file:///workspaces/${botA.id}/form.html`;
  await asA(() => desktopAction({ action: 'key', key: 'ctrl+l' }));
  await asA(() => desktopAction({ action: 'type', text: formUrl, submit: true }));
  await until(title, (value) => value.includes('Form test'));
  await asA(() => desktopAction({ action: 'type', text: 'Champ non envoyé' }));
  await until(title, (value) => value.includes('First:Champ non envoyé'));
  assert(!(await title()).includes('Submitted'));
  await asA(() => desktopAction({ action: 'key', key: 'Return' }));
  await until(title, (value) => value.includes('Submitted'));
  for (const launch of [['chromium', formUrl], ['exo-open', '--launch', 'WebBrowser', formUrl], ['xdg-open', formUrl]]) {
    await asA(() => desktopExec(['sh', '-c', 'pkill -u "$(id -u)" -x chromium || true']));
    await asA(screenshot); // A closed browser must not prevent screenshot/actions.
    await asA(() => desktopExec(['sh', '-c', '"$@" >/tmp/browser-launch.log 2>&1 &', 'launch', ...launch]));
    await until(title, (value) => value.includes('Form test'));
  }
  console.log('PASS saisie sans Entrée par défaut, submit:true explicite, formulaire non envoyé, relance terminal/Exo/xdg-open après fermeture.');

  const shot = await asA(screenshot), bytes = (await asA(() => readScreenshot(shot.screenshotId)))!;
  assert.equal(bytes.readUInt32BE(16), 1280); assert.equal(bytes.readUInt32BE(20), 800);
  assert.equal((await request(shot.url.replace('/api', ''))).status, 200);
  assert.equal((await request(shot.url.replace('/api', ''), cookieB)).status, 404);
  await writeFile('/tmp/opendots-desktop-capture.png', bytes);
  await asA(async () => {
    const created = botA;
    const policyUrl = `/computer/desktop/permissions/${created.id}`;
    assert.equal((await request(policyUrl, '', 'PUT', { mode: 'auto', actions: [] })).status, 401);
    assert.equal((await request(policyUrl, cookieB, 'PUT', { mode: 'auto', actions: [] })).status, 404);
    assert.equal((await request(policyUrl, cookieA, 'PUT', { mode: 'custom', actions: ['exec'] })).status, 400);
    const ctx = { agent: (await getAgent(created.id))!, conversationId: await mainConversationId(created.id), userTurn: true, isMain: true, depth: 0, tz: 'UTC' };
    const tools = (await buildCapabilityTools(ctx)).tools;
    const output: any = await tools.computer_screenshot.execute!({}, { toolCallId: 'screen', messages: [] } as any);
    const modelOutput = await tools.computer_screenshot.toModelOutput!({ toolCallId: 'screen', input: {}, output });
    assert.equal(modelOutput.type, 'content'); assert((modelOutput as any).value.some((p: any) => p.type === 'file' && p.mediaType === 'image/png'));
    const pointer = async () => (await desktopExec(['xdotool', 'getmouselocation', '--shell'])).toString();
    const prepare = () => tools.computer_action.execute!({ action: { action: 'move', x: 444, y: 333 }, reason: 'Déplacer le pointeur de test' }, { toolCallId: 'move', messages: [] } as any) as Promise<any>;
    assert.equal((await prepare()).status, 'executed');
    assert((await pointer()).includes('X=444\nY=333'));
    await desktopAction({ action: 'move', x: 100, y: 100 });
    assert.equal((await request(policyUrl, cookieA, 'PUT', { mode: 'custom', actions: ['move'] })).status, 200);
    assert.equal((await prepare()).status, 'executed');
    const guarded: any = await tools.computer_action.execute!({ action: { action: 'key', key: 'Return' }, reason: 'Touche non autorisée automatiquement' }, { toolCallId: 'key', messages: [] } as any);
    assert.equal(guarded.status, 'pending_approval');
    await resolveApproval(guarded.approvalId, 'reject', { by: 'ui', notifyAgent: false });
    await desktopAction({ action: 'move', x: 100, y: 100 });
    await setDesktopPermissions(created.id, { mode: 'ask', actions: [] });
    const before = await pointer();
    const pending = await prepare(); assert.equal(pending.status, 'pending_approval'); assert.equal(await pointer(), before);
    assert.equal((await resolveApproval(pending.approvalId, 'approve', { by: 'ui', notifyAgent: false })).status, 'executed');
    assert((await pointer()).includes('X=444\nY=333'));
    await assert.rejects(() => resolveApproval(pending.approvalId, 'approve', { by: 'ui', notifyAgent: false }));
    const refused = await prepare(); assert.equal((await resolveApproval(refused.approvalId, 'reject', { by: 'ui', notifyAgent: false })).status, 'rejected');
    const revoked = await prepare(); await updateAgent(created.id, { permissions: { ...ctx.agent.permissions, computer: false } });
    assert.equal((await resolveApproval(revoked.approvalId, 'approve', { by: 'ui', notifyAgent: false })).status, 'failed');
    await setDesktopPermissions(created.id, { mode: 'auto', actions: [] });
    assert.equal((await prepare()).ok, false);
    await updateAgent(created.id, { permissions: { ...ctx.agent.permissions, computer: true } });
    await setHumanControl(true); await assert.rejects(prepare, /pris la main/); await setHumanControl(false);
    await setHumanControl(true); await assert.rejects(screenshot, /pris la main/); await assert.rejects(() => desktopAction({ action: 'key', key: 'Return' }), /pris la main/); await setHumanControl(false);
    await setSetting('onboarding.done', true); await setOpenRouterKey('desktop-fixture-personal-key'); await setSetting('models.default', { provider: 'openrouter', model: 'fixture/vision' });
  });
  console.log('PASS PNG réel, actions directes par défaut, permissions personnalisées à chaud, validation sur demande, refus, anti-rejeu, retrait de permission, isolation API et reprise manuelle.');
  // A second real container gets a separate profile and filesystem.
  await asA(() => desktopExec(['sh', '-c', `printf alice > /workspaces/${botA.id}/private-alice.txt`]));
  await asB(async () => {
    await startDesktop();
    assert.equal((await desktopExec(['sh', '-c', `test ! -e /workspaces/${botA.id}/private-alice.txt && echo isolated`])).toString().trim(), 'isolated');
  });
  console.log('PASS deux conteneurs réels : fichiers et profils isolés entre comptes.');
  // Two bots of the same account share one kernel/container, never their screen/profile.
  const nameA = await asA(computerName);
  await asC(startDesktop);
  assert.equal(await asC(computerName), nameA);
  const uidA = (await asA(() => desktopExec(['id', '-u']))).toString().trim();
  const uidC = (await asC(() => desktopExec(['id', '-u']))).toString().trim();
  assert.notEqual(uidA, uidC);
  const shell = await asA(() => execShell(botA.id, 'id -u && printf from-shell > shell-note.txt'));
  assert(shell.stdout.includes(uidA));
  assert.equal((await asA(() => desktopExec(['cat', `/workspaces/${botA.id}/shell-note.txt`]))).toString(), 'from-shell');
  await assert.rejects(() => asC(() => desktopExec(['cat', `/workspaces/${botA.id}/.Xauthority`])));
  await assert.rejects(() => asC(() => desktopExec(['cat', `/workspaces/${botA.id}/.vnc/passwd`])));
  const slotA = await asA(async () => (await import('../src/settings.ts')).getSetting(`desktop.bot.${botA.id}`));
  await assert.rejects(() => asC(() => desktopExec(['sh', '-c', `DISPLAY=:${slotA!.slot} xdotool getdisplaygeometry`])));
  await asC(() => desktopExec(['sh', '-c', 'test ! -e "$HOME/private-alice.txt" && echo private']));
  const shotC = await asC(screenshot);
  assert.equal(await asA(() => readScreenshot(shotC.screenshotId)), null);
  await asA(() => setHumanControl(true));
  await asC(screenshot); await assert.rejects(() => asA(screenshot), /pris la main/);
  await asA(() => setHumanControl(false));
  console.log('PASS deux bots, un seul conteneur : UID, écran X11 authentifié, profil, captures et contrôle manuel séparés ; shell et bureau du même bot cohérents.');
  const longJob = asA(() => execShell(botA.id, 'sleep 3; echo active-job'));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal((await asA(computerState))?.paused, false);
  assert((await longJob).stdout.includes('active-job'));
  assert((await asA(() => execShell(botA.id, 'sleep 30', { timeoutSeconds: 1 }))).timedOut);
  await asA(screenshot);
  const browserPid = () => asA(async () => (await desktopExec(['sh', '-c', 'pgrep -u "$(id -u)" -o chromium'])).toString());
  const preservedPid = await browserPid();
  await until(() => asA(computerState), (state) => state?.paused === true);
  const resumedAt = performance.now();
  await asA(startDesktop);
  const resumeMs = Math.round(performance.now() - resumedAt);
  assert(resumeMs < 5000, `Reprise trop lente : ${resumeMs} ms`);
  console.log(`PASS pause automatique et reprise mesurée : ${resumeMs} ms (sessions conservées).`);
  assert.equal(await browserPid(), preservedPid);
  await run('docker', ['restart', '--time', '2', nameA]);
  assert.equal((await asA(desktopStatus)).running, false);
  await asC(startDesktop); await asA(startDesktop);
  assert.equal((await asA(() => desktopExec(['id', '-u']))).toString().trim(), uidA);
  assert.equal((await asC(() => desktopExec(['id', '-u']))).toString().trim(), uidC);
  assert.equal((await asA(() => desktopExec(['cat', `/workspaces/${botA.id}/shell-note.txt`]))).toString(), 'from-shell');
  console.log('PASS redémarrage complet, ordre inversé des bots, UID stables et fichiers persistants.');


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
  await page.getByText('Vue seule. Les modèles agissent selon les permissions de chaque compagnon.', { exact: true }).waitFor();
  const panel = page.getByLabel('Permissions du bureau — Vision', { exact: true });
  const selector = panel.getByRole('combobox', { name: 'Validation des actions — Vision' });
  await selector.click(); await page.getByRole('option', { name: 'Personnalisé', exact: true }).click();
  const typing = panel.getByRole('checkbox', { name: 'Saisie de texte', exact: true });
  await typing.check();
  await until(async () => Object.values(await (await request('/computer/desktop/permissions')).json()) as any[], (policies) => policies.some((p) => p.mode === 'custom' && p.actions.includes('type')));
  await page.reload(); await panel.getByRole('checkbox', { name: 'Saisie de texte', exact: true }).waitFor();
  assert(await panel.getByRole('checkbox', { name: 'Saisie de texte', exact: true }).isChecked());
  await page.route('**/api/computer/desktop/permissions/*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Sauvegarde temporairement indisponible' }) }));
  await selector.click(); await page.getByRole('option', { name: 'Toujours demander', exact: true }).click();
  await page.getByText('Sauvegarde temporairement indisponible', { exact: true }).waitFor();
  assert((await selector.textContent())?.includes('Personnalisé'));
  await page.unroute('**/api/computer/desktop/permissions/*');
  await selector.click(); await page.getByRole('option', { name: 'Toujours demander', exact: true }).click();
  await until(async () => Object.values(await (await request('/computer/desktop/permissions')).json()) as any[], (policies) => policies.some((p) => p.mode === 'ask'));
  await selector.click(); await page.getByRole('option', { name: 'Toujours autoriser', exact: true }).click();
  await until(async () => Object.values(await (await request('/computer/desktop/permissions')).json()) as any[], (policies) => policies.some((p) => p.mode === 'auto'));
  console.log('PASS panneau permissions dans Chromium : trois modes, réglage détaillé, sauvegarde et rechargement.');
  const botPicker = page.getByRole('combobox', { name: 'Bureau du compagnon', exact: true });
  await botPicker.click(); await page.getByRole('option', { name: 'Second', exact: true }).click();
  await canvas.waitFor();
  await page.getByRole('button', { name: 'Prendre la main', exact: true }).click();
  assert.equal(await asC(async () => (await desktopStatus()).manualControl), true);
  assert.equal(await asA(async () => (await desktopStatus()).manualControl), false);
  await page.getByRole('button', { name: 'Rendre la main aux modèles', exact: true }).click();
  await botPicker.click(); await page.getByRole('option', { name: 'Vision', exact: true }).click();
  await canvas.waitFor();
  console.log('PASS sélecteur de bureau par bot et reprise en main indépendante dans Chromium.');

  await asA(screenshot);
  await page.screenshot({ path: '/tmp/opendots-desktop-ui.png', fullPage: true });
  assert.deepEqual(errors, []);
  // An established websocket must be revoked immediately on logout.
  const ws = new WebSocket(origin.replace('http:', 'ws:') + `/api/computer/vnc?agentId=${botA.id}`, { headers: { cookie: cookieA, origin } });
  await once(ws, 'open'); const closed = once(ws, 'close');
  assert.equal((await request('/auth/logout', cookieA, 'POST', {})).status, 200); await closed;
  assert.equal(await rejectedSocket(cookieA), 401);
  cookieA = `opendots_session=${await createSession(a.id)}`;
  assert.equal((await request('/settings', cookieA, 'PUT', { shell: { network: false } })).status, 200);
  assert.equal((await asA(desktopStatus)).running, false);
  console.log('PASS arrêt des bureaux quand le réseau de l’ordinateur est désactivé.');
  console.log('PASS noVNC dans Chromium : canvas 1280×800, reprise manuelle et WebSocket révoqué à la déconnexion.');
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) { console.error('Browser:', await failedPage.getByRole('alert').allTextContents()); await failedPage.screenshot({ path: '/tmp/opendots-bot-ui-failure.png', fullPage: true }).catch(() => {}); }
  const diagnostics = await asA(() => run('docker', ['exec', computerName(), 'sh', '-c', 'for log in /run/opendots-sessions/*.log /workspaces/ag_*/.vnc/session.log /workspaces/ag_*/.vnc/chromium.log; do if [ -f "$log" ]; then tail -12 "$log"; fi; done'])).catch(() => null);
  if (diagnostics) console.error(diagnostics.stdout);
  try {
    await writeFile('/tmp/opendots-desktop-failure.png', await asA(() => desktopExec(['python3', '-c', `from PIL import ImageGrab; import sys, os; ImageGrab.grab(xdisplay=os.environ['DISPLAY']).save(sys.stdout.buffer,"PNG")`])));
  } catch { /* The container may have failed before X11 was available. */ }
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close(); closeSockets(); await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const account of [a, b]) await withAccount(account, () => run('docker', ['rm', '-f', computerName()])).catch(() => {});
  await closeAllDatabases(); await closeAuthStore(); await rm(dir, { recursive: true, force: true }).catch(() => {});
}
