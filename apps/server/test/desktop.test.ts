import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, generateText } from 'ai';
import { withAccount, type AccountContext } from '../src/auth/context.ts';
import { openDatabase, closeAllDatabases } from '../src/db/client.ts';
import { config } from '../src/config.ts';
import { setSetting } from '../src/settings.ts';
import { createAgent, getAgent, mainConversationId, updateAgent } from '../src/agents/repo.ts';
import { desktopTools } from '../src/computer/tools.ts';
import { desktopActionSchema, desktopEnabled, readScreenshot, screenshot, setHumanControl } from '../src/computer/desktop.ts';
import { withDesktopAgent, desktopAgentId, computerSlot } from '../src/computer/session.ts';
import { COMPUTER_ACTION_TYPES } from '@opendots/shared';
import { desktopActionNeedsApproval, getDesktopPermissions, setDesktopPermissions } from '../src/computer/permissions.ts';
const account: AccountContext = { id: 'desktop-unit', email: 'desktop@example.com', role: 'user', dataDir: `${config.dataDir}/desktop-unit` };
beforeAll(async () => { await withAccount(account, () => openDatabase({ memory: true })); });
afterAll(closeAllDatabases);
const ctx = async (computer: boolean) => {
 const created = await createAgent({ name: 'Vision', permissions: { computer } });
 return { agent: (await getAgent(created.id))!, conversationId: await mainConversationId(created.id), userTurn: true, isMain: true, depth: 0, tz: 'UTC' };
};
it('applique immédiatement les permissions par compagnon et isole les comptes', async () => withAccount(account, async () => {
  const first = (await ctx(true)).agent.id, second = (await ctx(true)).agent.id;
  expect((await getDesktopPermissions(first)).mode).toBe('auto');
  for (const action of COMPUTER_ACTION_TYPES) expect(await desktopActionNeedsApproval(first, action)).toBe(false);
  await setDesktopPermissions(first, { mode: 'ask', actions: ['click'] });
  for (const action of COMPUTER_ACTION_TYPES) expect(await desktopActionNeedsApproval(first, action)).toBe(true);
  await setDesktopPermissions(first, { mode: 'custom', actions: ['click', 'scroll'] });
  for (const action of COMPUTER_ACTION_TYPES) expect(await desktopActionNeedsApproval(first, action)).toBe(!['click', 'scroll'].includes(action));
  expect(await desktopActionNeedsApproval(second, 'type')).toBe(false);
  await withAccount({ ...account, id: 'permissions-other', dataDir: `${config.dataDir}/permissions-other` }, async () => {
    await openDatabase({ memory: true });
    expect((await getDesktopPermissions(first)).mode).toBe('auto');
  });
  await expect(setDesktopPermissions(first, { mode: 'custom', actions: ['exec'] } as any)).rejects.toThrow();
  expect((await getDesktopPermissions(first)).mode).toBe('custom');
}));
it('démarre à la demande pour le bon compagnon et respecte sa désactivation', async () => withAccount(account, async () => {
  const bot = await ctx(true);
  expect(Object.keys(await desktopTools(bot)).sort()).toEqual(['browser_inspect', 'computer_action', 'computer_inspect', 'computer_keyboard', 'computer_screenshot', 'computer_target']);
  await setSetting(`desktop.bot.${bot.agent.id}`, { enabled: false });
  expect(await desktopTools(bot)).toEqual({});
  expect(await desktopTools(await ctx(false))).toEqual({});
}));
it('valide coordonnées et touches sans accepter de commandes arbitraires', () => {
  for (const input of [{ action: 'click', x: -1, y: 1 }, { action: 'click', x: 1280, y: 1 }, { action: 'key', key: 'Return; id' }, { action: 'scroll', x: 1, y: 1, direction: 'down', amount: 1000 }, { action: 'type', text: '', command: 'sh' }]) expect(desktopActionSchema.safeParse(input).success).toBe(false);
  for (const text of ['première ligne\nseconde', 'commande\r', 'champ\tchamp', '\x00']) expect(desktopActionSchema.safeParse({ action: 'type', text }).success).toBe(false);
  expect(desktopActionSchema.parse({ action: 'type', text: 'Champ de formulaire' })).toMatchObject({ submit: false });
  expect(desktopActionSchema.parse({ action: 'type', text: 'https://example.com', submit: true })).toMatchObject({ submit: true });
  expect(desktopActionSchema.parse({ action: 'click', x: 1279, y: 799 })).toMatchObject({ button: 'left', double: false });
});
it('suspend uniquement le bureau sélectionné quand l’utilisateur prend la main', async () => withAccount(account, async () => {
  const a = await ctx(true), b = await ctx(true);
  await withDesktopAgent(a.agent.id, async () => {
    await setHumanControl(true);
    await expect(screenshot()).rejects.toThrow('pris la main');
    expect(await withDesktopAgent(b.agent.id, async () => desktopAgentId())).toBe(b.agent.id);
    expect(desktopAgentId()).toBe(a.agent.id);
    await setHumanControl(false);
  });
}));
it('isole les captures et refuse la traversée de répertoires', async () => withAccount(account, async () => {
  const agent = (await ctx(true)).agent;
  const id = 'a'.repeat(32), dir = join(account.dataDir, 'desktops', agent.id, 'screenshots'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${id}.png`), 'private');
  expect((await withDesktopAgent(agent.id, () => readScreenshot(id)))!.toString()).toBe('private');
  expect(await withDesktopAgent(agent.id, () => readScreenshot('../secret.key'))).toBeNull();
  expect(await withAccount({ ...account, id: 'other', dataDir: `${config.dataDir}/desktop-other` }, () => withDesktopAgent(agent.id, () => readScreenshot(id)))).toBeNull();
}));
it('sérialise la capture en image OpenRouter réelle, jamais en texte base64', async () => withAccount(account, async () => {
  const context = await ctx(true);
  const directory = join(account.dataDir, 'desktops', context.agent.id, 'screenshots'); await mkdir(directory, { recursive: true });
  const id = 'b'.repeat(32), bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(directory, `${id}.png`), bytes);
  const tools = await desktopTools(context);
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

it('exige un compagnon explicite et conserve les contextes concurrents', async () => {
  expect(() => desktopAgentId()).toThrow('Sélectionne');
  expect(() => withDesktopAgent('../escape', () => {})).toThrow('invalide');
  const values = await Promise.all(['ag_one', 'ag_two'].map((id) => withDesktopAgent(id, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5)); return desktopAgentId();
  })));
  expect(values).toEqual(['ag_one', 'ag_two']);
});
it('alloue des numéros persistants et distincts même avec des démarrages simultanés', async () => withAccount(account, async () => {
  const slots = await Promise.all(['ag_slot_one', 'ag_slot_two', 'ag_slot_one'].map(computerSlot));
  expect(slots[0]).not.toBe(slots[1]);
  expect(slots[0]).toBe(slots[2]);
  expect(await computerSlot('ag_slot_two')).toBe(slots[1]);
}));

it('un ancien réglage enabled ne réactive pas un bureau dont la permission est retirée', async () => withAccount(account, async () => {
  const bot = (await ctx(true)).agent;
  await setSetting(`desktop.bot.${bot.id}`, { enabled: true });
  await withDesktopAgent(bot.id, async () => {
    expect(await desktopEnabled()).toBe(true);
    await updateAgent(bot.id, { permissions: { ...bot.permissions, computer: false } });
    expect(await desktopEnabled()).toBe(false);
  });
}));
