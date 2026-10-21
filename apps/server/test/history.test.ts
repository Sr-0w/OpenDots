import { describe, expect, it } from 'vitest';
import { historyForModel } from '../src/agents/turn.ts';

const agent = { id: 'ag_self', name: 'Ari' } as any;
const user = (id: string, text: string) => ({ id, role: 'user', parts: [{ type: 'text', text }], metadata: { kind: 'chat' } }) as any;

describe('historique envoyé au modèle', () => {
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
  });
});
