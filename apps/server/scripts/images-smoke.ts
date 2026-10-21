/** Browser attachments + real private upload API; model stream is a local fixture. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
const directory = await mkdtemp(join(tmpdir(), 'opendots-image-ui-'));
process.env.OPENDOTS_DATA_DIR = directory;
const nativeFetch = globalThis.fetch, payloads: any[] = [];
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.includes('openrouter.ai/api/v1/chat/completions')) {
    const payload = JSON.parse(String(init?.body)); payloads.push(payload);
    const chunk = (delta: unknown, finish_reason: string | null) => JSON.stringify({ id: 'fixture', created: 1, model: payload.model, choices: [{ index: 0, delta, finish_reason }] });
    return new Response(`data: ${chunk({ role: 'assistant', content: `Images reçues ${payloads.length}.` }, null)}\n\ndata: ${chunk({}, 'stop')}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }
  if (url.startsWith('https://openrouter.ai/')) throw new Error(`Appel externe inattendu : ${url}`);
  return nativeFetch(input, init);
};
const { createApplication } = await import('../src/app.ts');
const { authStore, registerUser, createSession, closeAuthStore } = await import('../src/auth/store.ts');
const { withAccount } = await import('../src/auth/context.ts');
const { openDatabase, closeAllDatabases } = await import('../src/db/client.ts');
const { createAgent } = await import('../src/agents/repo.ts');
const { setSetting, setOpenRouterKey } = await import('../src/settings.ts');
await authStore(true);
const account = await registerUser('photos@example.com', 'photos browser test password'), other = await registerUser('other@example.com', 'photos browser test password');
const token = await createSession(account.id), otherToken = await createSession(other.id);
const agent = await withAccount(account, async () => {
  await openDatabase({ memory: true }); await setSetting('onboarding.done', true); await setSetting('models.default', { provider: 'openrouter', model: 'qwen/qwen3.8-27b' }); await setOpenRouterKey('fixture-not-a-real-key');
  return createAgent({ name: 'Photos' });
});
const app = createApplication(async () => { await openDatabase({ memory: true }); });
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
await new Promise<void>((resolve) => server.listening ? resolve() : server.once('listening', resolve));
const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser = await chromium.launch({ executablePath: process.env.OPENDOTS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] });
const image = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#2380df' } }).png().toBuffer();
try {
  const context = await browser.newContext({ locale: 'fr-BE', viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addCookies([{ name: 'opendots_session', value: token, url: origin }]);
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/#agent/${agent.id}`);
  const prompt = page.locator('textarea').first(), attachments = page.locator('[aria-label="Images jointes"]');
  await prompt.waitFor();
  const choose = async (name = 'fichier.png') => {
    const event = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Joindre des images', exact: true }).click();
    await (await event).setFiles({ name, mimeType: 'image/png', buffer: image });
  };
  await choose(); await attachments.getByRole('img', { name: 'fichier.png', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Envoyer', exact: true }).isEnabled(), true);
  await page.evaluate(async (encoded) => { const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)); await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]); }, image.toString('base64'));
  await prompt.focus(); await prompt.press('Control+v');
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Images jointes"] img').length === 2);
  assert.equal(await attachments.locator('img').count(), 2);
  await page.getByRole('button', { name: 'Retirer fichier.png', exact: true }).click();
  assert.equal(await attachments.locator('img').count(), 1); await choose();
  await page.locator('input[type=file]').setInputFiles({ name: 'texte.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await page.getByRole('alert').filter({ hasText: 'Choisis une image JPEG' }).waitFor();
  assert.equal(await attachments.locator('img').count(), 2);
  await prompt.fill('Analyse ces deux images');
  await page.route('**/api/attachments', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Upload temporairement indisponible' }) }));
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Upload temporairement indisponible' }).waitFor();
  assert.equal(await prompt.inputValue(), 'Analyse ces deux images'); assert.equal(await attachments.locator('img').count(), 2);
  await page.unroute('**/api/attachments');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await page.getByRole('log').getByText('Images reçues 1.', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await prompt.inputValue(), ''); assert.equal(await attachments.count(), 0);
  assert.equal(payloads[0].model, 'qwen/qwen3.8-27b');
  const parts = payloads[0].messages.find((m: any) => m.role === 'user').content;
  assert.equal(parts.filter((p: any) => p.type === 'image_url').length, 2);
  for (const part of parts.filter((p: any) => p.type === 'image_url')) assert(part.image_url.url.startsWith('data:image/jpeg;base64,'));
  const history = await (await context.request.get(`${origin}/api/agents/${agent.id}/messages`)).json();
  const stored = history.messages.find((m: any) => m.role === 'user');
  const files = stored.parts.filter((p: any) => p.type === 'file'); assert.equal(files.length, 2); assert(files.every((p: any) => /^\/api\/attachments\/[a-f0-9]{32}$/.test(p.url)));
  for (const file of files) assert.equal((await context.request.get(`${origin}${file.url}`)).status(), 200);
  assert.equal((await nativeFetch(`${origin}${files[0].url}`, { headers: { cookie: `opendots_session=${otherToken}` } })).status, 404);
  await page.reload(); await page.getByText('Analyse ces deux images', { exact: true }).waitFor();
  assert.equal(await page.locator('img[src^="/api/attachments/"]').count(), 2);
  await choose('seule.png'); await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await page.getByRole('log').getByText('Images reçues 2.', { exact: true }).waitFor();
  await page.evaluate(async () => navigator.clipboard.writeText('Texte collé normalement'));
  await prompt.focus(); await prompt.press('Control+v'); assert.equal(await prompt.inputValue(), 'Texte collé normalement');
  assert.equal(await attachments.count(), 0);
  await page.screenshot({ path: '/tmp/opendots-images-ui.png', fullPage: true });
  assert.deepEqual(errors, []);
  // Mobile layout uses the same + and native file input (gallery-capable on mobile).
  const mobile = await browser.newContext({ locale: 'fr-BE', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  await mobile.addCookies([{ name: 'opendots_session', value: token, url: origin }]);
  const phone = await mobile.newPage(); await phone.goto(`${origin}/#agent/${agent.id}`);
  const mobilePicker = phone.waitForEvent('filechooser'); await phone.getByRole('button', { name: 'Joindre des images', exact: true }).click();
  await (await mobilePicker).setFiles({ name: 'galerie.png', mimeType: 'image/png', buffer: image });
  await phone.locator('[aria-label="Images jointes"]').getByRole('img', { name: 'galerie.png' }).waitFor();
  const size = await phone.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert(size.scroll <= size.width);
  await phone.screenshot({ path: '/tmp/opendots-images-mobile.png', fullPage: true });
  console.log('PASS Chromium : bouton +, vrai collage image, même aperçu, suppression, erreur/réessai sans perte, images seules, texte collé, historique rechargé, isolation, octets JPEG vers Qwen et interface mobile.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: '/tmp/opendots-images-failure.png', fullPage: true }); console.error((await page.locator('body').innerText()).slice(-1800)); }
  throw error;
} finally {
  await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await closeAllDatabases(); await closeAuthStore(); globalThis.fetch = nativeFetch; await rm(directory, { recursive: true, force: true });
}
