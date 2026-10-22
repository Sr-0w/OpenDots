/** Real XFCE/Chromium/X11/noVNC test. Does not call a paid model or public site. */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const { saveMessage } = await import('../src/conversations/repo.ts');
const { desktopTools } = await import('../src/computer/tools.ts');
const { attachDesktopWebSocket } = await import('../src/computer/websocket.ts');
const { startDesktop, screenshot, readScreenshot, desktopAction, desktopExec, removeDesktop, setHumanControl, desktopStatus, semanticOperation } = await import('../src/computer/desktop.ts');
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
  throw new Error(`État attendu non atteint : ${JSON.stringify(last).slice(0, 1600)}`);
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
  await asA(() => execShell(botA.id, 'printf shell-only'));
  assert.equal((await asA(() => execShell(botA.id, 'pgrep -x chromium || true'))).stdout.trim(), '');
  await asA(async () => { await startDesktop(); });
  assert.equal((await asA(desktopStatus)).running, true);
  assert.equal((await asA(() => desktopExec(['sh', '-c', 'pgrep -u "$(id -u)" -x chromium || true']))).toString().trim(), '');
  await asA(() => desktopExec(['sh', '-c', `xterm -title OpenDots-terminal -e sh -c 'for name in terminal-paste terminal-abort terminal-takeover; do IFS= read -r line; printf "%s" "$line" > "$HOME/$name.txt"; done; sleep 30' >/tmp/xterm-launch.log 2>&1 &`]));
  await until(() => asA(async () => (await desktopExec(['sh', '-c', 'xdotool search --onlyvisible --name OpenDots-terminal || true'])).toString()), value => value.trim().length > 0);
  await asA(() => desktopExec(['xdotool', 'search', '--onlyvisible', '--name', '^OpenDots-terminal$', 'windowactivate', '--sync']));
  const terminalFocus = await asA(screenshot);
  assert.equal(terminalFocus.focusedWindow?.title, 'OpenDots-terminal');
  assert(terminalFocus.focusedWindow?.wmClass?.includes('XTerm'));
  assert(terminalFocus.focusedWindow!.geometry.width > 0 && terminalFocus.focusedWindow!.geometry.height > 0);
  // An unchanged clipboard proves type used native keys instead of pasting.
  await asA(() => desktopExec(['sh', '-c', 'printf clipboard-sentinel | xclip -selection clipboard -i >/dev/null 2>&1']));
  const terminalText = 'TEST_ARIA café — saisie sans Entrée';
  await asA(() => desktopAction({ action: 'type', text: terminalText }));
  assert.equal((await asA(() => desktopExec(['sh', '-c', 'test -e "$HOME/terminal-paste.txt" && echo submitted || true']))).toString().trim(), '');
  assert.equal((await asA(() => desktopExec(['xclip', '-selection', 'clipboard', '-o']))).toString(), 'clipboard-sentinel');
  await asA(() => desktopAction({ action: 'key', key: 'Return' }));
  await until(() => asA(async () => (await desktopExec(['sh', '-c', 'cat "$HOME/terminal-paste.txt" 2>/dev/null || true'])).toString()), value => value === terminalText);
  for (const mode of ['abort', 'takeover']) {
    const stop = new AbortController();
    const operation = asA(() => desktopAction({ action: 'type', text: 'A'.repeat(500) }, stop.signal));
    const rejected = assert.rejects(operation, mode === 'abort' ? /stop typing fixture/ : /pris la main/);
    await new Promise(resolve => setTimeout(resolve, 800));
    if (mode === 'abort') stop.abort(new Error('stop typing fixture'));
    else await asA(() => setHumanControl(true));
    await rejected;
    if (mode === 'takeover') await asA(() => setHumanControl(false));
    await asA(() => desktopAction({ action: 'type', text: 'tail' }));
    await asA(() => desktopAction({ action: 'key', key: 'Return' }));
    await until(() => asA(async () => (await desktopExec(['sh', '-c', `cat "$HOME/terminal-${mode}.txt" 2>/dev/null || true`])).toString()), value => /^A{1,499}tail$/.test(value));
  }
  console.log('PASS frappe interrompue par Stop et reprise manuelle : pas de texte restant ni de touche/modificateur bloqué.');
  await asA(() => desktopExec(['sh', '-c', 'pkill -u "$(id -u)" -x xterm']));
  console.log('PASS démarrage shell puis XFCE sans Chromium, terminal graphique utilisable, frappes Unicode réelles et aucune validation avant Return.');
  // Native accessible targets: no screenshot coordinates and no clipboard edits.
  const nativeFixture = await readFile(new URL('./fixtures/semantic-form.py', import.meta.url), 'utf8');
  await asA(() => desktopExec(['python3', '-c', `from pathlib import Path; (Path.home()/'semantic-form.py').write_text(${JSON.stringify(nativeFixture)})`]));
  const gtkLaunch = await asA(() => execShell(botA.id, 'python3 "$HOME/semantic-form.py" >"$HOME/.vnc/semantic-fixture.log" 2>&1 &'));
  assert.equal(gtkLaunch.exitCode, 0, gtkLaunch.stderr);
  const fixturePid = Number((await asA(() => desktopExec(['sh', '-c', 'pgrep -u "$(id -u)" -f "^python3 .*/semantic-form.py$"']))).toString().trim());
  const apps = await until(() => asA(() => semanticOperation({ engine: 'native', action: 'apps' })), value => value.ok && value.apps?.some((app: any) => app.pid === fixturePid));
  const nativeApp = apps.apps.find((app: any) => app.pid === fixturePid);
  const inspectNative = () => asA(() => semanticOperation({ engine: 'native', action: 'inspect', app: String(nativeApp.pid) }));
  const assertPointer = async (result: any) => {
    assert(result.pointer && Number.isInteger(result.pointer.x) && Number.isInteger(result.pointer.y), JSON.stringify(result));
    const actual = (await asA(() => desktopExec(['xdotool', 'getmouselocation', '--shell']))).toString();
    assert(actual.includes(`X=${result.pointer.x}\nY=${result.pointer.y}\n`), actual);
  };
  const actNative = async (name: string, action = 'focus') => {
    const state = await inspectNative(); assert.equal(state.ok, true, JSON.stringify(state));
    const element = state.elements.find((e: any) => e.name === name); assert(element, JSON.stringify(state));
    const operation = { engine: 'native' as const, action, snapshot: state.snapshot, ref: element.ref };
    const result = await asA(() => semanticOperation(operation)); assert.equal(result.ok, true, JSON.stringify(result));
    await assertPointer(result);
    const hover = JSON.parse((await asA(() => desktopExec(['sh', '-c', 'cat "$HOME/semantic-hover.json"']))).toString());
    assert.equal(hover.name, name, 'The real GTK widget must receive the pointer motion');
    assert.equal(hover.x, result.pointer.x); assert.equal(hover.y, result.pointer.y);
    assert.equal((await asA(() => semanticOperation(operation))).ok, false, 'A consumed snapshot must not repeat its action');
  };
  await actNative('Nom de test');
  await asA(() => desktopAction({ action: 'type', text: 'Ari été ✓' }));
  await actNative('Mot de passe de test');
  await asA(() => desktopAction({ action: 'type', text: 'Clé-native-123!' }));
  assert(!(JSON.stringify(await inspectNative())).includes('Clé-native-123!'));
  assert.equal((await asA(() => desktopExec(['sh', '-c', 'test -f "$HOME/semantic-submitted.json" && echo submitted || true']))).toString().trim(), '');
  await actNative('Enregistrer le formulaire', 'click');
  assert.deepEqual(JSON.parse((await asA(() => desktopExec(['sh', '-c', 'cat "$HOME/semantic-submitted.json"']))).toString()), { name: 'Ari été ✓', password: 'Clé-native-123!' });
  await asA(() => desktopExec(['sh', '-c', 'pkill -u "$(id -u)" -f "^python3 .*/semantic-form.py$" || true']));
  console.log('PASS Open Computer Use AT-SPI réel : champs ciblés par nom, touches Unicode, mot de passe masqué, absence de soumission implicite et snapshot consommé refusé.');
  for (const [x, y] of [[444, 333], [0, 0], [1279, 799]]) {
    await asA(() => desktopAction({ action: 'move', x, y }));
    const shot = await asA(screenshot);
    const realPointer = (await asA(() => desktopExec(['xdotool', 'getmouselocation', '--shell']))).toString();
    assert(realPointer.includes(`X=${x}\nY=${y}\n`));
    assert.equal(shot.cursor?.x, x); assert.equal(shot.cursor?.y, y);
    const png = (await asA(() => readScreenshot(shot.screenshotId)))!;
    const info = await sharp(png).metadata(); assert.equal(info.width, 1280); assert.equal(info.height, 800);
    if (x === 444) {
      const c = shot.cursor as any;
      assert.equal(c.source, 'xfixes'); assert(c.width > 0 && c.height > 0);
      const region = { left: x-c.hotspotX, top: y-c.hotspotY, width: c.width, height: c.height };
      const raw = await asA(() => desktopExec(['python3', '-c', 'from PIL import ImageGrab; import os,sys; ImageGrab.grab(xdisplay=os.environ["DISPLAY"]).save(sys.stdout.buffer,"PNG")']));
      const annotatedPixels = await sharp(png).extract(region).raw().toBuffer();
      const rawPixels = await sharp(raw).removeAlpha().extract(region).raw().toBuffer();
      assert(!annotatedPixels.equals(rawPixels), 'Native cursor pixels must be visible at its actual hotspot, unlike ImageGrab alone');
      await writeFile('/tmp/opendots-native-cursor.png', png);
    }
  }
  // Reproduce the reported point with an independently defined native cursor.
  // Move outside computer_action so a cached "last requested point" would fail.
  await asA(() => desktopAction({ action: 'move', x: 715, y: 52 }));
  await asA(() => desktopExec(['xdotool', 'mousemove', '1039', '110']));
  const cursorFixture = await readFile(new URL('./fixtures/native-cursor.py', import.meta.url), 'utf8');
  const cursorWindow = JSON.parse((await asA(() => desktopExec(['python3', '-c', cursorFixture, 'set']))).toString()).window;
  try {
    const actual = await asA(screenshot), cursor = actual.cursor as any;
    assert.deepEqual([cursor.x, cursor.y, cursor.hotspotX, cursor.hotspotY], [1039, 110, 4, 6]);
    const png = (await asA(() => readScreenshot(actual.screenshotId)))!;
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y*info.width+x)*info.channels, (y*info.width+x)*info.channels+3)];
    for (let y = 104; y < 113; y++) for (let x = 1035; x < 1044; x++) assert.deepEqual(pixel(x, y), [255, 0, 255]);
    assert.notDeepEqual(pixel(1034, 104), [255, 0, 255]);
    assert.notDeepEqual(pixel(1044, 112), [255, 0, 255]);
    await writeFile('/tmp/opendots-cursor-1039-110.png', png);
  } finally { await asA(() => desktopExec(['python3', '-c', cursorFixture, 'restore', String(cursorWindow)])); }
  console.log('PASS point (1039,110) : curseur natif indépendant 9×9, hotspot (4,6), pixels exacts et position différente du dernier appel computer_action.');
  await asA(() => desktopAction({ action: 'move', x: 444, y: 333 }));
  const repeatStart = Date.now();
  await asA(() => desktopAction({ action: 'move', x: 444, y: 333 }));
  await asA(() => desktopAction({ action: 'click', x: 444, y: 333 }));
  assert(Date.now()-repeatStart < 5000, 'Move/click at the current pointer location must not wait for a nonexistent motion event');
  console.log('PASS curseur X11 natif : pixels visibles au point actif réel, position confirmée par xdotool et captures aux deux coins sans décalage ni changement de résolution.');
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
  const opened = await asA(() => execShell(botA.id, 'opendots-open-browser about:blank'));
  assert.equal(opened.exitCode, 0, opened.stderr); assert(opened.durationMs < 5000, `Lancement trop lent : ${opened.durationMs} ms`);
  const background = await asA(() => execShell(botA.id, 'sleep 999 &', { timeoutSeconds: 2 }));
  assert.equal(background.timedOut, false); assert(background.durationMs < 5000); assert(background.stderr.includes('arrière-plan'));
  await asA(() => desktopExec(['sh', '-c', 'pkill -u "$(id -u)" -f "^sleep 999$" || true']));
  console.log('PASS navigateur détaché via le shell en moins de 5 s et retour immédiat pour sleep 999 &.');
  await until(() => asA(async () => (await desktopExec(['sh', '-c', 'window=$(xdotool search --onlyvisible --class chromium | head -n 1); test -n "$window" && xdotool windowactivate --sync "$window" && echo ready || true'])).toString()), value => value.includes('ready'));
  // Open Browser Use's actual extension, Go native host and private Unix socket.
  await asA(() => desktopExec(['python3', '-c', `from pathlib import Path
(Path.home()/'semantic-browser.html').write_text('''<!doctype html><meta charset="utf-8"><title>Semantic browser fixture</title><script>let keys=0,pastes=0;addEventListener('keydown',e=>{if(e.isTrusted)keys++});addEventListener('paste',()=>pastes++);addEventListener('mousemove',e=>{const t=e.target.closest('input,button')||e.target;const r=t.getBoundingClientRect();fetch('/hover?target='+encodeURIComponent(t.id||t.textContent||t.tagName)+'&dx='+(e.clientX-r.left-r.width/2)+'&dy='+(e.clientY-r.top-r.height/2));});</script><form onsubmit="document.title='Submitted:'+document.getElementById('name').value+':'+document.getElementById('password').value.length+':keys='+keys+':pastes='+pastes;return false"><label>Nom navigateur<input id=name></label><label>Mot de passe navigateur<input id=password type=password></label><button id=submit><span>Valider le formulaire navigateur</span></button><button id=stop type="button" onmousedown="document.title='MouseDown';let start=performance.now();while(performance.now()-start&lt;1500){}" onmouseup="document.title='MouseReleased'">Tester Stop pendant un clic</button></form>''', encoding='utf-8')`]));
  await asA(() => desktopExec(['sh', '-c', 'python3 -m http.server 8765 --bind 127.0.0.1 --directory "$HOME" >"$HOME/.vnc/browser-http.log" 2>&1 &']));
  await asA(() => desktopExec(['sh', '-c', 'pkill -u "$(id -u)" -x chromium || true']));
  await until(() => asA(async () => (await desktopExec(['sh', '-c', 'pgrep -u "$(id -u)" -x chromium || true'])).toString()), value => value.trim() === '');
  const browserOpen = await asA(() => semanticOperation({ engine: 'browser', action: 'open', url: 'http://127.0.0.1:8765/semantic-browser.html' }));
  assert.equal(browserOpen.ok, true, JSON.stringify(browserOpen));
  const inspectBrowser = () => asA(() => semanticOperation({ engine: 'browser', action: 'inspect', tabId: browserOpen.tabId }));
  await until(inspectBrowser, value => value.ok && value.elements.some((e: any) => e.name === 'Valider le formulaire navigateur'));
  const actBrowser = async (name: string, action = 'focus') => {
    await asA(() => desktopExec(['xdotool', 'mousemove', '0', '0']));
    const beforeHover = (await asA(() => desktopExec(['sh', '-c', 'cat "$HOME/.vnc/browser-http.log"']))).toString().length;
    const state = await inspectBrowser(); assert.equal(state.ok, true, JSON.stringify(state));
    const element = state.elements.find((e: any) => e.name === name && (action === 'click' ? e.role === 'button' : e.role === 'textbox')); assert(element, JSON.stringify(state));
    const operation = { engine: 'browser' as const, action, snapshot: state.snapshot, ref: element.ref };
    const result = await asA(() => semanticOperation(operation)); assert.equal(result.ok, true, JSON.stringify(result));
    await assertPointer(result);
    const expectedHover = name === 'Nom navigateur' ? 'name' : name === 'Mot de passe navigateur' ? 'password' : 'submit';
    const hoverLog = (await asA(() => desktopExec(['sh', '-c', 'cat "$HOME/.vnc/browser-http.log"']))).toString();
    const lastHover = [...hoverLog.slice(beforeHover).matchAll(/\/hover\?([^ ]+) /g)].at(-1);
    assert(lastHover, `Actual native pointer did not hover the DOM target: ${hoverLog}`);
    const hover = new URLSearchParams(lastHover[1]);
    assert.equal(hover.get('target'), expectedHover, hoverLog);
    assert(Math.abs(Number(hover.get('dx'))) <= 2 && Math.abs(Number(hover.get('dy'))) <= 2, `Pointer missed live DOM centre: ${lastHover[1]}`);
    assert.equal((await asA(() => semanticOperation(operation))).ok, false, 'A consumed browser snapshot must be rejected');
  };
  await actBrowser('Nom navigateur');
  await asA(() => desktopAction({ action: 'type', text: 'Ari navigateur ✓' }));
  await actBrowser('Mot de passe navigateur');
  await asA(() => desktopAction({ action: 'type', text: 'Secret-été-123' }));
  assert(!JSON.stringify(await inspectBrowser()).includes('Secret-été-123'));
  const browserTitle = async () => asA(async () => (await desktopExec(['xdotool', 'getactivewindow', 'getwindowname'])).toString());
  assert(!(await browserTitle()).includes('Submitted:'));
  // A zoomed, moved and resized browser must still receive REAL native hover
  // over the semantic target; CDP success alone cannot prove cursor calibration.
  await asA(() => desktopExec(['xdotool', 'key', 'ctrl+plus']));
  await actBrowser('Nom navigateur');
  await asA(() => desktopExec(['xdotool', 'key', 'alt+F10']));
  await asA(() => desktopExec(['sh', '-c', 'w=$(xdotool getactivewindow); xdotool windowsize "$w" 1000 650; xdotool windowmove "$w" 150 80']));
  await actBrowser('Mot de passe navigateur');
  await asA(() => desktopExec(['xdotool', 'key', 'ctrl+0']));
  await asA(() => desktopExec(['xdotool', 'key', 'alt+F10']));
  const stopState = await inspectBrowser();
  const stopButton = stopState.elements.find((e: any) => e.role === 'button' && e.name === 'Tester Stop pendant un clic'); assert(stopButton);
  const stopSemantic = new AbortController();
  const semanticClick = asA(() => semanticOperation({ engine: 'browser', action: 'click', snapshot: stopState.snapshot, ref: stopButton.ref }, stopSemantic.signal));
  const rejectedSemantic = assert.rejects(semanticClick, /stop semantic click/);
  await until(browserTitle, value => value.includes('MouseDown'));
  stopSemantic.abort(new Error('stop semantic click'));
  await rejectedSemantic;
  await until(browserTitle, value => value.includes('MouseReleased'));
  console.log('PASS Stop pendant un clic CDP : bouton relâché avant la sortie du moteur, aucune souris virtuelle bloquée.');
  await actBrowser('Valider le formulaire navigateur', 'click');
  await until(browserTitle, value => /Submitted:Ari navigateur ✓:14:keys=[1-9][0-9]*:pastes=0/.test(value));
  const staleBrowser = await inspectBrowser();
  await asA(() => desktopAction({ action: 'key', key: 'ctrl+l' }));
  await asA(() => desktopAction({ action: 'type', text: 'about:blank', submit: true }));
  await until(browserTitle, value => !value.includes('Submitted:'));
  const staleResult = await asA(() => semanticOperation({ engine: 'browser', action: 'focus', snapshot: staleBrowser.snapshot, ref: staleBrowser.elements.find((e: any) => e.name === 'Nom navigateur' && e.role === 'textbox').ref }));
  assert.equal(staleResult.ok, false); assert.match(staleResult.error, /navigated/);
  console.log('PASS Open Browser Use réel : extension locale + Go natif + socket privé, DOM/AX nommé, focus, frappe trusted Unicode/mot de passe, clic sans coordonnées devinées, snapshot périmé après navigation refusé.');
  // Regression #10: page offsets must be added ONLY for the document hit-test,
  // while pointer movement and trusted mouse events retain viewport coordinates.
  await asA(() => desktopExec(['python3', '-c', `from pathlib import Path
(Path.home()/'semantic-scroll.html').write_text('''<!doctype html><title>Scroll target fixture</title><style>body{margin:0;width:3000px;height:2600px;font:20px sans-serif}.target{position:absolute;left:2100px;top:1900px;width:80px}</style><div class=target><a href="#done" aria-label="Learn more" onclick="event.preventDefault();document.title='Scrolled link clicked'"><span>Learn more</span></a></div><script>if(location.search.includes('covered')){const cover=document.createElement('div');cover.style='position:fixed;inset:0;background:#ccc;z-index:9999';cover.textContent='Real blocking overlay';document.body.append(cover)}addEventListener('mousemove',e=>{const a=e.target.closest('a');if(a)fetch('/scroll-hover?x='+e.clientX+'&y='+e.clientY)});</script>''', encoding='utf-8')`]));
  for (const covered of [false, true]) {
    const opened = await asA(() => semanticOperation({ engine: 'browser', action: 'open', url: `http://127.0.0.1:8765/semantic-scroll.html${covered ? '?covered' : ''}` }));
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const state = await until(() => asA(() => semanticOperation({ engine: 'browser', action: 'inspect', tabId: opened.tabId })), value => value.ok && value.elements.some((e: any) => e.role === 'link' && e.name === 'Learn more'));
    const link = state.elements.find((e: any) => e.role === 'link' && e.name === 'Learn more');
    const result = await asA(() => semanticOperation({ engine: 'browser', action: 'click', snapshot: state.snapshot, ref: link.ref }));
    assert.equal(result.ok, !covered, JSON.stringify(result));
    const layout = JSON.parse((await asA(() => desktopExec(['python3', '-c', `import importlib.util,json
s=importlib.util.spec_from_file_location('s','/usr/local/share/opendots/semantic-bridge.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.cdp(${opened.tabId},'Page.getLayoutMetrics')['cssLayoutViewport']))`]))).toString());
    assert(layout.pageX > 0 && layout.pageY > 0, JSON.stringify(layout));
    const title = await browserTitle();
    if (covered) { assert.match(result.error, /covered/); assert(!title.includes('Scrolled link clicked')); }
    else { await assertPointer(result); assert(title.includes('Scrolled link clicked'), title); }
  }
  console.log('PASS #10 : lien multiligne/descendant après défilement X/Y, vrai pointeur et clic Chromium ; vraie surcouche toujours refusée.');
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
  const cancelClick = new AbortController();
  const movingClick = asA(() => desktopAction({ action: 'click', ...position }, cancelClick.signal));
  const noClick = assert.rejects(movingClick, /stop before click/);
  setTimeout(() => cancelClick.abort(new Error('stop before click')), 90);
  await noClick;
  assert(!(await title()).includes('Clicked'), 'Stop during motion must not send the pending click');
  await asA(() => desktopAction({ action: 'click', ...position }));
  await until(title, (value) => value.includes('Clicked'));
  await asA(() => desktopAction({ action: 'scroll', direction: 'down', amount: 4, x: 700, y: 600 }));
  await until(title, (value) => /Scrolled:[1-9]/.test(value));
  console.log('PASS Chromium réel : saisie Unicode, touches, cible identifiée dans les pixels, clic et défilement.');
  await asA(() => desktopExec(['python3', '-c', `from pathlib import Path
import os
(Path.home()/'form.html').write_text("""<meta charset="utf-8"><title>Form test</title><script>window.keyEvents=0;window.pasteEvents=0;addEventListener('keydown',e=>{if(e.isTrusted)keyEvents++});addEventListener('paste',e=>{pasteEvents++;e.preventDefault()})</script><form onsubmit='document.title="Submitted";return false'><input id=a autofocus oninput='document.title="First:"+this.value'><input id=b type=password onfocus='window.keyEvents=0' oninput='document.title="Password:"+(this.value==="Clé-été-123!✓")+";keys:"+keyEvents+";pastes:"+pasteEvents'><button>Submit</button></form>""",encoding='utf-8')`]));
  const formUrl = `file:///workspaces/${botA.id}/form.html`;
  await asA(() => desktopAction({ action: 'key', key: 'ctrl+l' }));
  await asA(() => desktopAction({ action: 'type', text: formUrl, submit: true }));
  await until(title, (value) => value.includes('Form test'));
  await asA(() => desktopAction({ action: 'type', text: 'Champ non envoyé' }));
  await until(title, (value) => value.includes('First:Champ non envoyé'));
  assert(!(await title()).includes('Submitted'));
  await asA(() => desktopAction({ action: 'key', key: 'Tab' }));
  await asA(() => desktopAction({ action: 'type', text: 'Clé-été-123!✓' }));
  const passwordTitle = await until(title, value => /Password:true;keys:[1-9][0-9]*;pastes:0/.test(value));
  assert(Number(/keys:(\d+)/.exec(passwordTitle)![1]) >= 'Clé-été-123!✓'.length);
  assert.equal((await asA(() => desktopExec(['xclip', '-selection', 'clipboard', '-o']))).toString(), 'clipboard-sentinel');
  console.log('PASS champ mot de passe Unicode : vraies touches trusted, collage bloqué par la page, presse-papiers inchangé et formulaire non soumis.');
  await asA(() => desktopAction({ action: 'key', key: 'Return' }));
  await until(title, (value) => value.includes('Submitted'));
  for (const launch of [['chromium', formUrl], ['exo-open', '--launch', 'WebBrowser', formUrl], ['xdg-open', formUrl]]) {
    await asA(() => desktopExec(['sh', '-c', 'pkill -u "$(id -u)" -x chromium || true']));
    await asA(screenshot); // A closed browser must not prevent screenshot/actions.
    if (launch[0] === 'chromium') {
      const raw = await asA(() => execShell(botA.id, `chromium --no-sandbox --new-window ${formUrl} &`, { timeoutSeconds: 3 }));
      assert(!raw.timedOut); assert(raw.durationMs < 5000);
    } else await asA(() => desktopExec(['sh', '-c', '"$@" >/tmp/browser-launch.log 2>&1 &', 'launch', ...launch]));
    try { await until(title, (value) => value.includes('Form test')); }
    catch (error) { console.error('Lanceur en échec:', launch[0], (await asA(() => desktopExec(['sh', '-c', 'cat /tmp/browser-launch.log 2>/dev/null || true']))).toString()); throw error; }
    console.log('PASS relance navigateur :', launch[0]);
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
  const runtimeA = (await asA(() => desktopExec(['printenv', 'XDG_RUNTIME_DIR']))).toString().trim();
  await assert.rejects(() => asC(() => desktopExec(['cat', `${runtimeA}/obu/active.json`])));
  const otherApps = await asC(() => semanticOperation({ engine: 'native', action: 'apps' }));
  assert.equal(otherApps.ok, true, JSON.stringify(otherApps));
  assert(!otherApps.apps.some((app: any) => /chromium|semantic-fixture/i.test(app.name)));
  assert.equal((await asC(() => semanticOperation({ engine: 'browser', action: 'tabs' }))).ok, false, 'A bot without a browser must not discover another bot’s socket');
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
  assert.equal((await asA(desktopStatus)).restartRequired, true);
  await asC(startDesktop); await asA(startDesktop);
  for (const context of [asA, asC]) assert.equal((await context(() => desktopExec(['sh', '-c', 'pgrep -u "$(id -u)" -x chromium || true']))).toString().trim(), '');
  assert.equal((await asA(() => desktopExec(['id', '-u']))).toString().trim(), uidA);
  assert.equal((await asC(() => desktopExec(['id', '-u']))).toString().trim(), uidC);
  assert.equal((await asA(() => desktopExec(['cat', `/workspaces/${botA.id}/shell-note.txt`]))).toString(), 'from-shell');
  console.log('PASS redémarrage complet, ordre inversé des bots, UID stables et fichiers persistants.');


  if (process.env.OPENDOTS_DESKTOP_LIVE_WEB === '1') {
    await asA(() => desktopExec(['sh', '-c', 'chromium https://example.com >"$HOME/.vnc/chromium.log" 2>&1 &']));
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
  const canvas = page.locator('[aria-label="Bureau distant"] canvas:not([data-remote-pointer])');
  assert.equal(await canvas.evaluate((element: HTMLCanvasElement) => element.width), 1280);
  await asA(() => assert.rejects(screenshot, /pris la main/));
  await page.getByRole('button', { name: 'Rendre la main aux modèles', exact: true }).click();
  await page.getByText('Vue seule. Les modèles agissent selon les permissions de chaque compagnon.', { exact: true }).waitFor();
  // Verify actual RFB shape + PointerPos are visible even in view-only mode.
  await asA(() => desktopAction({ action: 'move', x: 100, y: 400 }));
  const vncCursor = JSON.parse((await asA(() => desktopExec(['python3', '-c', cursorFixture, 'set']))).toString()).window;
  try {
    const pointer = page.locator('canvas[data-remote-pointer]');
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[data-remote-pointer]') as HTMLCanvasElement;
      if (!c || c.dataset.x !== '100' || c.dataset.y !== '400' || !c.width || !c.height || c.style.display === 'none') return false;
      return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((value,index) => index%4 === 3 && value > 0);
    });
    const samples = pointer.evaluate(async (element: HTMLCanvasElement) => {
      const points: number[][] = [], started = performance.now();
      while (performance.now()-started < 1400) {
        if (element.style.display !== 'none') points.push([Number(element.dataset.x), Number(element.dataset.y)]);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return points;
    });
    await asA(() => desktopAction({ action: 'move', x: 900, y: 600 }));
    const points = await samples;
    const hot = await pointer.evaluate(element=>({ x:Number(element.dataset.hotspotX), y:Number(element.dataset.hotspotY) }));
    assert(new Set(points.map(point => point.join(','))).size >= 3, `noVNC must show intermediate cursor frames: ${JSON.stringify(points)}`);
    assert(points.some(([x,y]) => x === 900 && y === 600), `Final native hotspot must match RFB: ${JSON.stringify(points)}`);
    assert(points.some(([x,y]) => x > 100 && x < 850 && Math.abs(y-400-(x-100)/4) > 5), 'The visible cursor path must be curved, not a teleport or a straight line');
    for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(100);
      const screen = (await canvas.boundingBox())!, cursor = (await pointer.boundingBox())!;
      assert(Math.abs(cursor.x-(screen.x+(900-hot.x)*screen.width/1280)) < 1, 'Pointer hotspot X must follow native/display scaling');
      assert(Math.abs(cursor.y-(screen.y+(600-hot.y)*screen.height/800)) < 1, 'Pointer hotspot Y must follow native/display scaling');
      await page.screenshot({ path: `/tmp/opendots-remote-pointer-${viewport.width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
  } finally { await asA(() => desktopExec(['python3', '-c', cursorFixture, 'restore', String(vncCursor)])).catch(() => {}); }
  console.log('PASS Cursor Motion Linux visible dans noVNC : positions intermédiaires courbes du vrai pointeur, sprite RFB standard, hotspot final exact et échelle desktop/mobile.');

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
  // Real post-action image must also be visible in chat, not only screenshot tools.
  const imageTools = await asA(async () => desktopTools({ agent: (await getAgent(botA.id))!, conversationId: await mainConversationId(botA.id) } as any));
  await asA(() => imageTools.computer_screenshot.execute!({}, { toolCallId: 'before', messages: [] } as any));
  const actionShot: any = await asA(() => imageTools.computer_action.execute!({ action: 'move', x: 1039, y: 110, reason: 'Observer le pointeur réel' }, { toolCallId: 'real-action', messages: [] } as any));
  assert.equal(actionShot.status, 'executed'); assert.equal(actionShot.cursor.x, 1039); assert.equal(actionShot.cursor.y, 110);
  await asA(async () => saveMessage(await mainConversationId(botA.id), { id: 'real-post-action', role: 'assistant', parts: [{ type: 'tool-computer_action', toolCallId: 'real-action', state: 'output-available', input: { action: 'move', x: actionShot.cursor?.x ?? 0, y: actionShot.cursor?.y ?? 0, reason: 'Observer le pointeur réel' }, output: actionShot }], metadata: { agentId: botA.id } } as any, { author: 'agent', agentId: botA.id }));
  await page.goto(`${origin}/#/agent/${botA.id}`);
  const chatShot = page.getByRole('img', { name: 'Capture du bureau privé', exact: true });
  await chatShot.waitFor();
  await page.waitForFunction(() => { const img = document.querySelector('img[alt="Capture du bureau privé"]') as HTMLImageElement; return img?.complete && img.naturalWidth === 1280; });
  await page.getByText('Après action — vérifie le résultat visible', { exact: false }).waitFor();
  if (actionShot.visualChange === 'unchanged') await page.getByText('Écran inchangé', { exact: false }).waitFor();
  await page.screenshot({ path: '/tmp/opendots-post-action-chat.png', fullPage: true });
  console.log('PASS capture après computer_action visible dans le chat avec curseur réel et retour visuel de l’outil.');
  for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Vérifier les coordonnées', exact: true }).click();
    const inspector = page.getByRole('dialog');
    const area = inspector.getByRole('button', { name: 'Inspecter un point de la capture', exact: true });
    await page.waitForFunction(() => { const img = document.querySelector('[role=dialog] img') as HTMLImageElement; return img?.complete && img.naturalWidth === 1280; });
    await inspector.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
    const rect = (await area.boundingBox())!;
    await area.click({ position: { x: 1039.5/1280*rect.width, y: 110.5/800*rect.height } });
    const selected = /\((\d+), (\d+)\)/.exec((await inspector.getByRole('status').textContent())!)!;
    const inspectedX = Number(selected[1]), inspectedY = Number(selected[2]);
    assert(Math.abs(inspectedX-1039) <= Math.ceil(1280/rect.width) && Math.abs(inspectedY-110) <= Math.ceil(800/rect.height), 'Pointer precision must account for CSS pixel rounding in a reduced preview');
    assert(await inspector.evaluate(element => element.getBoundingClientRect().width <= innerWidth));
    await area.press('ArrowRight');
    await inspector.getByRole('status').filter({ hasText: `Point inspecté : (${inspectedX+1}, ${inspectedY})` }).waitFor();
    await page.screenshot({ path: `/tmp/opendots-coordinate-inspector-${viewport.width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
  }
  console.log('PASS inspecteur desktop/mobile : la miniature renvoie les coordonnées natives (1039,110), sans modifier le bureau.');
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
  const diagnostics = await asA(() => run('docker', ['exec', computerName(), 'sh', '-c', 'for log in /run/opendots-sessions/*.log /workspaces/ag_*/.vnc/*.log; do if [ -f "$log" ]; then tail -12 "$log"; fi; done'])).catch(() => null);
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
