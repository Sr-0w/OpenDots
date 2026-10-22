import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  ask: false, manual: false, allowed: true,
  semantic: vi.fn(async () => ({ ok: true, elements: [] })),
  keyboard: vi.fn(async () => ({ ok: true })),
  approval: vi.fn(async () => ({ id: 'approval' })),
  handlers: new Map<string, Function>(),
}));
vi.mock('../src/computer/desktop.ts', async (original) => ({ ...await original<any>(), desktopEnabled: async () => true, humanControl: async () => state.manual, semanticOperation: state.semantic, desktopAction: state.keyboard }));
vi.mock('../src/agents/repo.ts', () => ({ getAgent: async () => ({ id: 'ag_semantic', permissions: { computer: state.allowed } }) }));
vi.mock('../src/computer/permissions.ts', () => ({ desktopActionNeedsApproval: async () => state.ask }));
vi.mock('../src/approvals/service.ts', () => ({ registerApprovalAction: (name: string, handler: Function) => state.handlers.set(name, handler), createApproval: state.approval }));
import { semanticTools } from '../src/computer/semantic-tools.ts';
const controller = new AbortController();
const ctx = { agent: { id: 'ag_semantic', permissions: { computer: true } }, conversationId: 'cv_semantic', abortSignal: controller.signal } as any;
const options = { toolCallId: 'call', messages: [] } as any;
const target = { engine: 'native', action: 'focus', snapshot: 'a'.repeat(24), ref: '2', reason: 'Saisir dans le champ identifié' };
beforeEach(() => { vi.clearAllMocks(); state.ask = state.manual = false; state.allowed = true; });
it('expose les inspections texte avec le contexte du bot et le signal Stop', async () => {
  const tools = semanticTools(ctx);
  await tools.computer_inspect.execute!({}, options);
  await tools.computer_inspect.execute!({ app: '123' }, options);
  await tools.browser_inspect.execute!({ tabId: 7 }, options);
  expect(state.semantic.mock.calls).toEqual([
    [{ engine: 'native', action: 'apps' }, controller.signal],
    [{ engine: 'native', action: 'inspect', app: '123' }, controller.signal],
    [{ engine: 'browser', action: 'inspect', tabId: 7 }, controller.signal],
  ]);
});
it('respecte auto, ask et la prise en main avant toute action sémantique', async () => {
  const tools = semanticTools(ctx);
  await tools.computer_target.execute!(target as any, options);
  expect(state.semantic).toHaveBeenCalledTimes(1);
  state.ask = true;
  expect(await tools.computer_target.execute!(target as any, options)).toMatchObject({ status: 'pending_approval' });
  expect(state.semantic).toHaveBeenCalledTimes(1);
  expect(state.approval).toHaveBeenCalledWith(expect.objectContaining({ action: 'computer.semantic', input: expect.objectContaining({ agentId: 'ag_semantic' }) }));
  state.manual = true;
  await expect(tools.computer_target.execute!(target as any, options)).rejects.toThrow('pris la main');
  expect(state.semantic).toHaveBeenCalledTimes(1);
});
it('revalide les permissions lors de l’approbation différée', async () => {
  state.allowed = false;
  await expect(state.handlers.get('computer.semantic')!({ agentId: 'ag_semantic', operation: { engine: 'native', action: 'focus', snapshot: 'a'.repeat(24), ref: '2' } })).rejects.toThrow('retiré');
  expect(state.semantic).not.toHaveBeenCalled();
});
it('refuse les refs devinées, les URL dangereuses et la saisie avec retour à la ligne implicite', async () => {
  const tools = semanticTools(ctx);
  for (const invalid of [{ ...target, snapshot: 'not-a-snapshot' }, { ...target, ref: '-1' }, { engine: 'browser', action: 'open', url: 'javascript:alert(1)', reason: 'x' }]) {
    expect(await tools.computer_target.execute!(invalid as any, options)).toMatchObject({ ok: false, status: 'invalid_input' });
  }
  expect(await tools.computer_keyboard.execute!({ action: 'type', text: 'a\nb', reason: 'x' }, options)).toMatchObject({ ok: false });
  expect(state.semantic).not.toHaveBeenCalled(); expect(state.keyboard).not.toHaveBeenCalled();
});
it('garde le clavier natif sans vision et sans soumission implicite', async () => {
  const tools = semanticTools(ctx);
  await tools.computer_keyboard.execute!({ action: 'type', text: 'secret', reason: 'Saisie' }, options);
  expect(state.keyboard).toHaveBeenCalledWith({ action: 'type', text: 'secret', submit: false }, controller.signal);
  await tools.computer_keyboard.execute!({ action: 'key', key: 'Return', reason: 'Soumettre explicitement' }, options);
  expect(state.keyboard).toHaveBeenLastCalledWith({ action: 'key', key: 'Return' }, controller.signal);
});

it('autorise les frappes répétées sans ajouter Entrée automatiquement', async () => {
  const tools = semanticTools(ctx);
  const input = { action: 'type', text: 'https://shop.example/search', submit: false, reason: 'Saisir une URL' } as const;
  for (let i = 0; i < 4; i++) expect(await tools.computer_keyboard.execute!(input, options)).toMatchObject({ ok: true });
  expect(state.keyboard).toHaveBeenCalledTimes(4);
  expect(state.keyboard.mock.calls.every((c: any) => c[0].submit === false)).toBe(true);
});
