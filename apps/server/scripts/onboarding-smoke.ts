/** Real onboarding/browser/queue; only the external model API is a local fixture. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright';
const directory = await mkdtemp(join(tmpdir(), 'opendots-welcome-ui-'));
process.env.OPENDOTS_DATA_DIR = directory;
const greeting = 'Salut ! Je suis ton nouveau compagnon. Quel nom aimerais-tu me donner ?';
const nativeFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === 'https://openrouter.ai/api/v1/key') return Response.json({ data: { label: 'fixture' } });
  if (url === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [{ id: 'fixture/welcome', name: 'Modèle de test', supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } }] });
  if (url.includes('openrouter.ai/api/v1/chat/completions')) {
    calls++;
    const payload = JSON.parse(String(init?.body)); assert.match(JSON.stringify(payload.messages), /Start the conversation yourself now/);
    assert.equal(payload.tools?.length ?? 0, 0);
    await new Promise(resolve => setTimeout(resolve, 300));
    const chunk = (delta: unknown, finish_reason: string | null) => JSON.stringify({ id: 'welcome', created: 1, model: payload.model, choices: [{ index: 0, delta, finish_reason }] });
    return new Response(`data: ${chunk({ role: 'assistant', content: greeting }, null)}\n\ndata: ${chunk({}, 'stop')}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }
  if (url.startsWith('https://openrouter.ai/')) throw new Error(`Unexpected external request: ${url}`);
  return nativeFetch(input, init);
};
const { createApplication } = await import('../src/app.ts');
const { authStore, registerUser, createSession, closeAuthStore } = await import('../src/auth/store.ts');
const { activateAccount, stopAccountRuntimes } = await import('../src/auth/runtime.ts');
const { closeAllDatabases } = await import('../src/db/client.ts');
const { registerLifeHandlers } = await import('../src/life/engine.ts');
await authStore(true); registerLifeHandlers();
const account = await registerUser('welcome@example.com', 'welcome browser password');
const token = await createSession(account.id);
const app = createApplication(activateAccount), server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.OPENDOTS_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ locale: 'fr-BE', viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'opendots_session', value: token, url: origin }]);
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByPlaceholder('sk-or-v1-…').fill('fixture-personal-key');
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await page.getByRole('button', { name: /Modèle de test/ }).click();
  await page.getByRole('button', { name: 'Rencontrer mon compagnon', exact: true }).click();
  await page.getByRole('log').getByText(greeting, { exact: true }).waitFor();
  assert.equal(await page.locator('textarea').inputValue(), '');
  const suggestions = ['Salut !', 'Comment devrais-je t’appeler ?', 'Qu’est-ce que tu sais faire ?', 'Tous les matins à 8 h, fais-moi un point sur ma journée', 'Souviens-toi que je préfère des réponses courtes', 'Crée un compagnon pour m’aider avec mes projets'];
  const absent = async (target: typeof page) => { for (const suggestion of suggestions) assert.equal(await target.getByRole('button', { name: suggestion, exact: true }).count(), 0); };
  await absent(page);
  const [agent] = await (await context.request.get(`${origin}/api/agents`)).json();
  const history = await (await context.request.get(`${origin}/api/agents/${agent.id}/messages`)).json();
  assert.deepEqual(history.messages.map((m: any) => m.role), ['assistant']);
  for (const response of await Promise.all([1, 2].map(() => context.request.post(`${origin}/api/onboarding/complete`, { headers: { 'x-opendots-client': '1' }, data: { model: { provider: 'openrouter', model: 'fixture/welcome' } } })))) assert.equal(response.status(), 200);
  await page.reload(); await page.getByRole('log').getByText(greeting, { exact: true }).waitFor(); await absent(page);
  const mobile = await browser.newContext({ locale: 'fr-BE', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  await mobile.addCookies([{ name: 'opendots_session', value: token, url: origin }]);
  const phone = await mobile.newPage(); await phone.goto(origin); await phone.getByRole('log').getByText(greeting, { exact: true }).waitFor(); await absent(phone);
  assert.equal(calls, 1); assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/opendots-onboarding-desktop.png', fullPage: true });
  await phone.screenshot({ path: '/tmp/opendots-onboarding-mobile.png', fullPage: true });
  console.log('PASS onboarding réel : accueil automatique sans saisie utilisateur, aucun prompt suggéré, pas de doublon après requêtes répétées/rechargement, desktop et mobile. API modèle simulée, aucun appel payant.');
} finally {
  await browser.close(); await stopAccountRuntimes(); await new Promise<void>(resolve => server.close(() => resolve()));
  await closeAllDatabases(); await closeAuthStore(); globalThis.fetch = nativeFetch; await rm(directory, { recursive: true, force: true });
}
