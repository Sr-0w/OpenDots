import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, generateText } from 'ai';
import { withAccount, type AccountContext } from '../src/auth/context.ts';
import { openDatabase, closeAllDatabases } from '../src/db/client.ts';
import { config } from '../src/config.ts';
import { setSetting } from '../src/settings.ts';
import { createAgent, getAgent, mainConversationId } from '../src/agents/repo.ts';
import { desktopTools } from '../src/computer/tools.ts';
import { desktopActionSchema, readScreenshot, screenshot, setHumanControl } from '../src/computer/desktop.ts';
const account: AccountContext = { id: 'desktop-unit', email: 'desktop@example.com', role: 'user', dataDir: `${config.dataDir}/desktop-unit` };
beforeAll(async () => { await withAccount(account, () => openDatabase({ memory: true })); });
afterAll(closeAllDatabases);
const ctx = async (computer: boolean) => {
 const created = await createAgent({ name: 'Vision', permissions: { computer } });
 return { agent: (await getAgent(created.id))!, conversationId: await mainConversationId(created.id), userTurn: true, isMain: true, depth: 0, tz: 'UTC' };
};
it('n’expose aucun outil graphique sans accord du compte et du compagnon', async () => withAccount(account, async () => {
  expect(await desktopTools(await ctx(true))).toEqual({});
  await setSetting('desktop.config', { enabled: true });
  expect(await desktopTools(await ctx(false))).toEqual({});
  expect(Object.keys(await desktopTools(await ctx(true))).sort()).toEqual(['computer_action', 'computer_screenshot']);
}));
it('valide coordonnées et touches sans accepter de commandes arbitraires', () => {
  for (const input of [{ action: 'click', x: -1, y: 1 }, { action: 'click', x: 1280, y: 1 }, { action: 'key', key: 'Return; id' }, { action: 'scroll', x: 1, y: 1, direction: 'down', amount: 1000 }, { action: 'type', text: '', command: 'sh' }]) expect(desktopActionSchema.safeParse(input).success).toBe(false);
  expect(desktopActionSchema.parse({ action: 'click', x: 1279, y: 799 })).toMatchObject({ button: 'left', double: false });
});
it('suspend les captures des modèles quand l’utilisateur prend la main', async () => withAccount(account, async () => {
  await setHumanControl(true);
  await expect(screenshot()).rejects.toThrow('pris la main');
  await setHumanControl(false);
}));
it('isole les captures et refuse la traversée de répertoires', async () => withAccount(account, async () => {
  const id = 'a'.repeat(32), dir = join(account.dataDir, 'screenshots'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${id}.png`), 'private');
  expect((await readScreenshot(id))!.toString()).toBe('private');
  expect(await readScreenshot('../secret.key')).toBeNull();
  expect(await withAccount({ ...account, id: 'other', dataDir: `${config.dataDir}/desktop-other` }, () => readScreenshot(id))).toBeNull();
}));
it('sérialise la capture en image OpenRouter réelle, jamais en texte base64', async () => withAccount(account, async () => {
  const id = 'b'.repeat(32), bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(account.dataDir, 'screenshots', `${id}.png`), bytes);
  const tools = await desktopTools(await ctx(true));
  const messages = await convertToModelMessages([{ role: 'assistant', parts: [{ type: 'tool-computer_screenshot', toolCallId: 'screen', state: 'output-available', input: {}, output: { ok: true, screenshotId: id, width: 1, height: 1 } }] }], { tools });
  let sent: any;
  const model = createOpenRouter({ apiKey: 'fixture-not-a-real-key', fetch: async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'fixture', created: 1, model: 'fixture/vision', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Observed' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
  } }).chat('fixture/vision');
  expect((await generateText({ model, messages })).text).toBe('Observed');
  const result = sent.messages.find((m: any) => m.role === 'tool');
  expect(result.content).toContainEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } });
}));
