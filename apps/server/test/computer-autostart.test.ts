import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ agents: [] as any[], settings: { mode: 'auto', network: true }, disabled: new Set<string>(), children: [] as any[], started: [] as string[], fail: '' }));
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough(); child.kill = vi.fn(() => { child.emit('close', 0); return true; });
  state.children.push(child); return child;
}) }));
vi.mock('../src/agents/repo.ts', () => ({ listAgentRows: async () => state.agents }));
vi.mock('../src/settings.ts', () => ({ getShellSettings: async () => state.settings, getSetting: async (key: string) => state.disabled.has(key) ? { enabled: false } : null }));
vi.mock('../src/computer/shell.ts', async () => {
  const { currentAccount } = await import('../src/auth/context.ts');
  return { computerName: () => `computer-${currentAccount()!.id}`, dockerAvailable: async () => true };
});
vi.mock('../src/computer/desktop.ts', async () => {
  const { currentAccount } = await import('../src/auth/context.ts');
  const { desktopAgentId } = await import('../src/computer/session.ts');
  return { startDesktop: async () => {
    state.started.push(`${currentAccount()!.id}:${desktopAgentId()}`);
    if (desktopAgentId() === state.fail) throw new Error('Failed desktop');
  } };
});
import { registerComputerAutostart, stopComputerAutostart } from '../src/computer/autostart.ts';
const a = { id: 'account-a', dataDir: '/tmp/autostart-a' } as any;
const b = { id: 'account-b', dataDir: '/tmp/autostart-b' } as any;
const bot = (id: string, computer = true, archived = false) => ({ id, archived, permissions: { computer } });
beforeEach(() => { vi.useFakeTimers(); state.agents = [bot('ag_ready')]; state.settings = { mode: 'auto', network: true }; state.started = []; state.children = []; state.disabled.clear(); state.fail = ''; });
afterEach(async () => { await stopComputerAutostart(); vi.useRealTimers(); });
it('démarre seulement les bureaux autorisés et activés, même si un autre échoue', async () => {
  state.agents = [bot('ag_denied', false), bot('ag_archived', true, true), bot('ag_off'), bot('ag_broken'), bot('ag_ready')];
  state.disabled.add('desktop.bot.ag_off'); state.fail = 'ag_broken';
  await registerComputerAutostart(a);
  expect(state.started).toEqual(['account-a:ag_broken', 'account-a:ag_ready']);
});
it('filtre les événements Docker et restaure uniquement le compte concerné', async () => {
  await registerComputerAutostart(a); await registerComputerAutostart(b);
  expect(state.children).toHaveLength(1); state.started = [];
  state.children[0].stdout.write('invalid\n' + JSON.stringify({ Type: 'container', Action: 'start', Actor: { Attributes: { name: 'unrelated-container' } } }) + '\n');
  state.children[0].stdout.write(JSON.stringify({ Type: 'container', Action: 'start', Actor: { Attributes: { name: 'computer-account-b' } } }) + '\n');
  await vi.waitFor(() => expect(state.started).toEqual(['account-b:ag_ready']));
});
it('se reconnecte après une perte du daemon sans ressusciter les bureaux désactivés', async () => {
  await registerComputerAutostart(a); state.started = [];
  state.disabled.add('desktop.bot.ag_ready'); state.children[0].emit('close', 1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.children).toHaveLength(2); expect(state.started).toEqual([]);
  await stopComputerAutostart(); await vi.advanceTimersByTimeAsync(10_000);
  expect(state.children).toHaveLength(2);
});
it('respecte les modes off/host et le réseau coupé sans démarrer un bureau', async () => {
  for (const settings of [{ mode: 'off', network: true }, { mode: 'host', network: true }, { mode: 'auto', network: false }]) {
    state.settings = settings; await registerComputerAutostart(a);
  }
  expect(state.started).toEqual([]);
});
