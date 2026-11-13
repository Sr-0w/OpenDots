/** Real CDP/native transport regression: large trees, paging and target identity. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'opendots-ax-'));
process.env.OPENDOTS_DATA_DIR = dir;
const { authStore, registerUser, closeAuthStore } = await import('../src/auth/store.ts');
const { withAccount } = await import('../src/auth/context.ts');
const { openDatabase, closeAllDatabases } = await import('../src/db/client.ts');
const { createAgent } = await import('../src/agents/repo.ts');
const { withDesktopAgent } = await import('../src/computer/session.ts');
const { desktopExec, semanticOperation } = await import('../src/computer/desktop.ts');
const { computerName } = await import('../src/computer/shell.ts');
const { setSetting, getShellSettings } = await import('../src/settings.ts');
await authStore(true);
const account = await registerUser('ax@example.com', 'ax transport test password');
await withAccount(account, () => openDatabase({ memory: true }));
// Pin the image ID: a concurrent rebuild must not recreate the test container
// halfway through validating UID/profile identity.
await withAccount(account, async () => {
  const settings = await getShellSettings();
  const image = (await run('docker', ['image', 'inspect', '--format', '{{.Id}}', settings.image])).stdout.trim();
  await setSetting('shell.config', { ...settings, image });
  console.log('Testing image', image);
});
const a = await withAccount(account, () => createAgent({ name: 'AX A', permissions: { computer: true } }));
const b = await withAccount(account, () => createAgent({ name: 'AX B', permissions: { computer: true } }));
const as = <T>(bot: typeof a, fn: () => T) => withAccount(account, () => withDesktopAgent(bot.id, fn));
const op = (input: any, bot = a): Promise<any> => as(bot, () => semanticOperation({ engine: 'browser', ...input }));
async function inspect(tabId: number, extra = {}) {
  const result = await op({ action: 'inspect', tabId, ...extra });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert(result.elements.length <= 400);
  assert(Buffer.byteLength(JSON.stringify(result)) < 500000);
  return result;
}
async function loaded(tabId: number, match: (v: any) => boolean, extra = {}) {
  for (let i = 0; i < 40; i++) {
    const v = await inspect(tabId, extra);
    if (match(v)) return v;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Page content not observed');
}
try {
  const tabs = await op({ action: 'tabs' }); assert(tabs.ok, JSON.stringify(tabs)); console.log('Browser started');
  const pid = () => as(a, async () => (await desktopExec(['sh', '-c', `ps -u "$(id -u)" -o pid=,comm=,args= | awk '$2 == "chromium" && !/--type=/ {print $1}'`])).toString());
  const firstPid = await pid(); assert(firstPid.trim());
  await as(a, () => desktopExec(['python3', '-c', `from pathlib import Path
import subprocess
p=Path.home()
(p/'large.html').write_text("""<title>Large fixture</title><button onclick="document.title='Verified click'">Verify large</button><input aria-label="Verify focus">"""+''.join('<button aria-label="Item '+str(i)+' '+('x'*500)+'">go</button>' for i in range(12000)))
(p/'small.html').write_text("""<title>Small fixture</title><button onclick="document.title='Small clicked'">Small action</button>""")
subprocess.Popen(['python3','-m','http.server','8765','--bind','127.0.0.1','--directory',str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)`]));
  const open = async (url: string) => { const r = await op({ action: 'open', url }); assert(r.ok, JSON.stringify(r)); return r.tabId; };
  const large = await open('http://127.0.0.1:8765/large.html');
  let state = await loaded(large, v => v.elements.some((e: any) => e.name === 'Verify large'), { depth: 8, limit: 100 });
  assert(state.nextOffset !== null); assert(state.truncated);
  const page = await inspect(large, { depth: 8, offset: state.nextOffset, limit: 100 }); assert(page.offset === 100);
  state = await inspect(large, { depth: 8 });
  const button = state.elements.find((e: any) => e.name === 'Verify large' && e.role === 'button'); assert(button);
  state = await inspect(large, { snapshot: state.snapshot, ref: button.ref });
  const detailed = state.elements.find((e: any) => e.name === 'Verify large' && e.role === 'button'); assert(detailed);
  const clicked = await op({ action: 'click', snapshot: state.snapshot, ref: detailed.ref }); assert(clicked.ok, JSON.stringify(clicked));
  await loaded(large, v => v.elements.some((e: any) => e.role === 'RootWebArea' && e.name === 'Verified click'));
  state = await inspect(large, { depth: 8 });
  const input = state.elements.find((e: any) => e.role === 'textbox'); assert(input);
  assert((await op({ action: 'focus', snapshot: state.snapshot, ref: input.ref })).ok);
  state = await inspect(large, { depth: 8 });
  assert(state.elements.some((e: any) => e.role === 'textbox' && e.properties.some((p: any) => p.name === 'focused' && p.value.value === true)));
  const longTarget = state.elements.find((e: any) => e.role === 'button' && e.name.startsWith('Item 0 ')); assert(longTarget);
  await as(a, () => desktopExec(['python3', '-c', `import importlib.util
s=importlib.util.spec_from_file_location('bridge','/usr/local/share/opendots/semantic-bridge.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.cdp(${large},'Runtime.evaluate',{'expression': '''const target=document.querySelectorAll('button')[1];target.setAttribute('aria-label',target.getAttribute('aria-label')+'changed')'''})`]));
  const changed = await op({ action: 'click', snapshot: state.snapshot, ref: longTarget.ref });
  assert.equal(changed.ok, false); assert.match(changed.error, /Element changed/);
  console.log('PASS 12000-node fixture: bounded transport, paging, detail, verified click/focus, long-name identity');
  const small = await open('http://127.0.0.1:8765/small.html');
  state = await loaded(small, v => v.elements.some((e: any) => e.name === 'Small action'));
  const sb = state.elements.find((e: any) => e.role === 'button'); assert(sb);
  assert((await op({ action: 'click', snapshot: state.snapshot, ref: sb.ref })).ok);
  await loaded(small, v => v.elements.some((e: any) => e.name === 'Small clicked'));
  const wiki = await open('https://fr.wikipedia.org/wiki/IPv6');
  state = await loaded(wiki, v => v.url.includes('/wiki/IPv6') && v.elements.some((e: any) => e.name.includes('IPv6')), { depth: 8, limit: 400 });
  console.log('Wikipedia elements', state.elements.length, 'partial', state.partial);
  const link = state.elements.find((e: any) => e.role === 'link' && e.name === 'IPv4') || state.elements.find((e: any) => e.role === 'link' && e.name.includes('accueil')); assert(link, JSON.stringify(state).slice(0, 2000));
  const linkName = link.name;
  state = await inspect(wiki, { snapshot: state.snapshot, ref: link.ref });
  const dl = state.elements.find((e: any) => e.role === 'link' && e.name === linkName); assert(dl);
  assert((await op({ action: 'click', snapshot: state.snapshot, ref: dl.ref })).ok);
  await loaded(wiki, v => v.url !== 'https://fr.wikipedia.org/wiki/IPv6');
  assert.equal(await pid(), firstPid);
  const other = await op({ action: 'tabs' }, b); assert(other.ok);
  assert(!other.tabs.some((t: any) => [large, small, wiki].includes(t.id) && /8765|wikipedia/.test(t.url || '')));
  const wrong = await op({ action: 'inspect', tabId: large }, b); assert.equal(wrong.ok, false);
  const homes = await Promise.all([a,b].map(bot => as(bot, async () => (await desktopExec(['sh','-c','printf "%s %s" "$(id -u)" "$HOME"'])).toString()))); assert.notEqual(homes[0], homes[1]);
  console.log('PASS Wikipedia IPv6: real detail and navigation verified; small page, reuse, bot isolation');
} finally {
  for (const bot of [a,b]) await as(bot, () => run('docker', ['rm', '-f', computerName()])).catch(() => {});
  await closeAllDatabases(); await closeAuthStore(); await rm(dir, { recursive: true, force: true }).catch(() => {});
}
