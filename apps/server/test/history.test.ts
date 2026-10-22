import { describe, expect, it } from 'vitest';
import { historyForModel } from '../src/agents/turn.ts';

const agent = { id: 'ag_self', name: 'Ari' } as any;
const user = (id: string, text: string) => ({ id, role: 'user', parts: [{ type: 'text', text }], metadata: { kind: 'chat' } }) as any;

describe('historique envoyé au modèle', () => {
  it('rejoue seulement deux captures récentes sans modifier l’historique stocké', () => {
    const messages = [user('u', 'Regarde'), ...[1, 2, 3, 4].map(n => ({ id: `s${n}`, role: 'assistant', parts: [{ type: 'tool-computer_action', state: 'output-available', toolCallId: `t${n}`, input: {}, output: { ok: true, screenshotId: `shot${n}`, url: `/screens/${n}` } }] } as any))];
    const out = historyForModel(messages, agent, new Map(), false);
    const parts = out.flatMap(m => m.parts) as any[];
    expect(parts.filter(p => p.output?.screenshotId).map(p => p.output.screenshotId)).toEqual(['shot3', 'shot4']);
    expect(parts.filter(p => p.output?.screenshot === 'omitted_from_history')).toHaveLength(2);
    expect((messages[1] as any).parts[0].output.screenshotId).toBe('shot1');
  });
  it('ne rejoue pas les anciens arguments shell invalides comme exemples exécutables', () => {
    const parts = [
      { type: 'tool-shell_exec', toolCallId: 'bad', state: 'output-error', input: { preview: 'partial command', truncated: 'true' }, errorText: 'command is required' },
      { type: 'tool-shell_exec', toolCallId: 'good', state: 'output-available', input: { command: 'pwd', timeout_seconds: 1 }, output: { stdout: '/workspaces' } },
    ];
    const out = historyForModel([user('u', 'Teste le shell'), { id: 'a', role: 'assistant', parts } as any], agent, new Map(), false);
    expect(out[1].parts.filter((p: any) => p.type === 'tool-shell_exec')).toEqual([parts[1]]);
    expect(JSON.stringify(out[1].parts)).toContain('command is required');
    expect(parts[0].input).toEqual({ preview: 'partial command', truncated: 'true' });
  });
  it('garde le contexte ancien malgré un tour très outillé', () => {
    const heavy = { id: 'a2', role: 'assistant', metadata: {}, parts: [
      { type: 'reasoning', text: 'r'.repeat(50_000) },
      { type: 'tool-shell_exec', toolCallId: 't1', state: 'output-available', input: { command: `cat > f.py <<EOF\n${'x'.repeat(120_000)}\nEOF` }, output: { stdout: 'y'.repeat(60_000) } },
      { type: 'text', text: 'Fichiers prêts.' },
    ] } as any;
    const messages = [user('u1', 'Retiens le mot code : AZUR'), { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Noté.' }], metadata: {} } as any, user('u2', 'Prépare le dépôt'), heavy, user('u3', 'Quel était le mot ?')];
    const out = historyForModel(messages, agent, new Map(), false);
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
    const compact = JSON.stringify(out.find((m) => m.id === 'a2')!.parts);
    expect(compact.length).toBeLessThan(12_000);
    expect(compact).not.toContain('r'.repeat(100));
    expect(compact).toContain('Fichiers prêts.');
    expect(out.find((m) => m.id === 'a2')!.parts.some((p: any) => p.type === 'tool-shell_exec')).toBe(false);
    expect(compact).toContain('not an executable tool call');
  });
});

