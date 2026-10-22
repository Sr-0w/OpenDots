/** Real chat/cards/queue/Docker. Model and OAuth provider are local fixtures. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const directory = await mkdtemp(join(tmpdir(), 'opendots-welcome-ui-'));
process.env.OPENDOTS_DATA_DIR = directory;
process.env.OPENDOTS_GOOGLE_CLIENT_ID = 'welcome-oauth-fixture';
process.env.OPENDOTS_GOOGLE_CLIENT_SECRET = 'welcome-oauth-fixture-secret';
const greeting = 'Salut ! Je suis ton nouveau compagnon. Quel nom aimerais-tu me donner ?';
const nativeFetch = globalThis.fetch;
let calls = 0;
let phase = 'welcome', gmailOffered = false;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === 'https://openrouter.ai/api/v1/key') return Response.json({ data: { label: 'fixture' } });
  if (url === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [{ id: 'fixture/welcome', name: 'Modèle de test', supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } }] });
  if (url.includes('openrouter.ai/api/v1/chat/completions')) {
    calls++;
    const payload = JSON.parse(String(init?.body));
    if (phase === 'welcome') { assert.match(JSON.stringify(payload.messages), /Start the conversation yourself now/); assert.match(JSON.stringify(payload.messages), /setup cards/); assert.equal(payload.tools?.length ?? 0, 0); }
    else { assert.match(JSON.stringify(payload.messages), /Catalogue prêt à connecter/); assert(payload.tools.some((t: any) => t.function.name === 'connection_request_setup')); }
    await new Promise(resolve => setTimeout(resolve, 300));
    const chunk = (delta: unknown, finish_reason: string | null) => JSON.stringify({ id: 'welcome', created: 1, provider: calls % 2 ? 'Fixture A' : 'Fixture B', model: payload.model, choices: [{ index: 0, delta, finish_reason }] });
    let delta: unknown = { role: 'assistant', content: phase === 'welcome' ? greeting : phase === 'computer' ? 'Mon ordinateur est prêt.' : 'Connecte Gmail depuis cette carte pour envoyer ton message.' }, finish = 'stop';
    if (phase === 'gmail' && !gmailOffered) { gmailOffered = true; finish = 'tool_calls'; delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'gmail-setup', type: 'function', function: { name: 'connection_request_setup', arguments: JSON.stringify({ kind: 'integration', provider: 'gmail', permissions: ['send'], reason: 'Envoyer ton message avec Gmail' }) } }] }; }
    return new Response(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, finish)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }
  if (url.startsWith('https://openrouter.ai/')) throw new Error(`Unexpected external request: ${url}`);
  return nativeFetch(input, init);
};
const { createApplication } = await import('../src/app.ts');
const { authStore, registerUser, createSession, closeAuthStore } = await import('../src/auth/store.ts');
const { activateAccount, stopAccountRuntimes } = await import('../src/auth/runtime.ts');
const { closeAllDatabases } = await import('../src/db/client.ts');
const { registerLifeHandlers } = await import('../src/life/engine.ts');
const { withAccount } = await import('../src/auth/context.ts');
const { createConnector, updateConnector } = await import('../src/connectors/repo.ts');
const { computerName } = await import('../src/computer/shell.ts');
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
  assert.deepEqual(history.messages[0].metadata.modelSteps, [{ step: 1, model: 'fixture/welcome', provider: 'Fixture A', responseId: 'welcome' }]);
  for (const response of await Promise.all([1, 2].map(() => context.request.post(`${origin}/api/onboarding/complete`, { headers: { 'x-opendots-client': '1' }, data: { model: { provider: 'openrouter', model: 'fixture/welcome' } } })))) assert.equal(response.status(), 200);
  await page.reload(); await page.getByRole('log').getByText(greeting, { exact: true }).waitFor(); await absent(page);
  const mobile = await browser.newContext({ locale: 'fr-BE', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  await mobile.addCookies([{ name: 'opendots_session', value: token, url: origin }]);
  const phone = await mobile.newPage(); await phone.goto(origin); await phone.getByRole('log').getByText(greeting, { exact: true }).waitFor(); await absent(phone);
  assert.equal(calls, 1); assert.deepEqual(errors, []);
  for (const target of [page, phone]) {
    await target.getByRole('region', { name: 'Connecter tes services' }).getByRole('button', { name: 'Connecter Gmail', exact: true }).waitFor();
    await target.getByRole('button', { name: 'Activer et démarrer l’ordinateur', exact: true }).waitFor();
  }
  assert.equal(agent.permissions.computer, false);
  await context.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/html', body: 'OAuth fixture, no real login.' }));
  // A normal Gmail request must expose a real actionable setup card.
  phase = 'gmail';
  await page.locator('textarea').fill('Envoie un mail avec Gmail à test@example.com pour dire bonjour.');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  const requestCard = page.getByText('Envoyer ton message avec Gmail', { exact: true }).locator('..').locator('..').locator('..');
  await requestCard.getByRole('button', { name: 'Configurer', exact: true }).click();
  let traced: any;
  for (let i = 0; i < 50; i++) { const stored = await (await context.request.get(`${origin}/api/agents/${agent.id}/messages`)).json(); traced = stored.messages.find((m: any) => m.role === 'assistant' && m.metadata?.modelSteps?.length === 2); if (traced) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.deepEqual(traced?.metadata.modelSteps.map((step: any) => step.provider), ['Fixture B', 'Fixture A']);
  let dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: 'Connecter Gmail', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('checkbox').nth(0).isChecked(), false);
  assert.equal(await dialog.getByRole('checkbox').nth(1).isChecked(), true);
  const popupPromise = page.waitForEvent('popup'); await dialog.getByRole('button', { name: 'Continuer avec le fournisseur' }).click();
  const popup = await popupPromise; await popup.waitForURL('https://accounts.google.com/**');
  const authorization = new URL(popup.url()); assert(authorization.searchParams.get('scope')!.includes('gmail.compose')); assert(!authorization.searchParams.get('scope')!.includes('gmail.readonly')); assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  await popup.close(); await dialog.getByRole('button', { name: 'Continuer avec le fournisseur' }).waitFor({ state: 'visible' }); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  // A read-only existing Gmail account needs reauthorization, not another account.
  let readonlyId = '';
  await withAccount(account, async () => { const connector = await createConnector({ name: 'Gmail lecture', kind: 'integration', config: { provider: 'gmail', account: { id: 'fixture', label: 'fixture' }, permissions: ['read'], grantedScopes: [] } }); readonlyId = connector.id; await updateConnector(connector.id, { status: 'ok' }); });
  await requestCard.getByRole('button', { name: 'Autoriser les accès', exact: true }).click();
  dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: 'Connecter Gmail', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('checkbox').nth(0).isChecked(), true); assert.equal(await dialog.getByRole('checkbox').nth(1).isChecked(), true);
  const reconnectRequest = page.waitForRequest(request => request.url().endsWith('/api/integrations/oauth/start'));
  const reconnectPopup = page.waitForEvent('popup'); await dialog.getByRole('button', { name: 'Continuer avec le fournisseur' }).click();
  const reconnect = await reconnectRequest; assert.equal(reconnect.postDataJSON().connectorId, readonlyId); assert.equal(reconnect.postDataJSON().requestedBy, agent.id); assert.deepEqual(reconnect.postDataJSON().permissions.sort(), ['read', 'send']);
  const again = await reconnectPopup; await again.waitForURL('https://accounts.google.com/**'); await again.close();
  await dialog.getByRole('button', { name: 'Continuer avec le fournisseur' }).waitFor({ state: 'visible' }); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  // Start a real private Docker desktop from the chat, without navigating away.
  phase = 'computer';
  const chatUrl = page.url();
  await page.getByRole('button', { name: 'Activer et démarrer l’ordinateur', exact: true }).click();
  await page.getByRole('region', { name: 'Configurer l’ordinateur' }).getByRole('status').filter({ hasText: 'Ordinateur démarré' }).waitFor({ timeout: 90000 });
  await page.getByRole('log').getByText('Mon ordinateur est prêt.', { exact: true }).waitFor();
  const computer = await (await context.request.get(`${origin}/api/computer/desktop?agentId=${agent.id}`)).json(); assert.equal(computer.running, true);
  const refreshed = await (await context.request.get(`${origin}/api/agents/${agent.id}`)).json(); assert.equal(refreshed.permissions.computer, true);
  assert.equal(page.url(), chatUrl); assert.equal(calls, 4); assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/opendots-onboarding-desktop.png', fullPage: true });
  await phone.screenshot({ path: '/tmp/opendots-onboarding-mobile.png', fullPage: true });
  console.log('PASS accueil et cartes desktop/mobile, Gmail demandé dans le chat, OAuth PKCE avec accès envoi sélectionné, reconnexion lecture seule, ordinateur Docker réel démarré depuis la carte et agent réveillé. Aucun menu ni appel payant ; fournisseurs simulés.');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close(); await stopAccountRuntimes(); await new Promise<void>(resolve => server.close(() => resolve()));
  await promisify(execFile)('docker', ['exec', withAccount(account, computerName), 'chown', '-R', `${process.getuid!()}:${process.getgid!()}`, '/workspaces']).catch(() => {});
  await promisify(execFile)('docker', ['rm', '-f', withAccount(account, computerName)]).catch(() => {});
  await closeAllDatabases(); await closeAuthStore(); globalThis.fetch = nativeFetch; await rm(directory, { recursive: true, force: true }).catch(error => console.error('Fixture cleanup:', error.message));
}
