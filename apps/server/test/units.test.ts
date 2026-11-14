import { describe, expect, it } from 'vitest';
import { computeNextRun, validateSchedule, describeSchedule } from '../src/activities/repo.ts';
import { htmlToText } from '../src/tools/web.ts';
import { decryptSecret, encryptSecret, maskSecret } from '../src/secrets.ts';
import { KeyedMutex, singleFlight, truncate } from '../src/util.ts';
import { buildSystemPrompt } from '../src/agents/prompt.ts';
import { DEFAULT_PERMISSIONS, isSingleEmoji, partitionToolNarrative, presentAssistantTurn } from '@opendots/shared';

describe('planifications', () => {
  const from = new Date('2026-10-21T10:00:00Z');

  it('calcule une exécution unique future, puis plus rien', () => {
    expect(computeNextRun({ type: 'once', at: '2026-10-21T11:00:00Z' }, 'UTC', from)?.toISOString()).toBe('2026-10-21T11:00:00.000Z');
    expect(computeNextRun({ type: 'once', at: '2026-10-21T09:00:00Z' }, 'UTC', from)).toBeNull();
  });

  it('calcule un intervalle', () => {
    expect(computeNextRun({ type: 'interval', minutes: 90 }, 'UTC', from)?.toISOString()).toBe('2026-10-21T11:30:00.000Z');
  });

  it('respecte le fuseau horaire des expressions cron', () => {
    // 8 h à Paris (UTC+2 en octobre) = 6 h UTC
    const next = computeNextRun({ type: 'cron', expr: '0 8 * * *', tz: 'Europe/Paris' }, 'UTC', from);
    expect(next?.toISOString()).toBe('2026-10-22T06:00:00.000Z');
  });

  it('refuse les horaires invalides', () => {
    expect(() => validateSchedule({ type: 'cron', expr: 'pas un cron' }, 'UTC')).toThrow();
    expect(() => validateSchedule({ type: 'interval', minutes: 0 }, 'UTC')).toThrow();
    expect(() => validateSchedule({ type: 'once', at: 'demain' }, 'UTC')).toThrow();
  });

  it('décrit les horaires en français', () => {
    expect(describeSchedule({ type: 'interval', minutes: 120 })).toBe('toutes les 2 h');
    expect(describeSchedule(null)).toBe('sur événement');
  });
});

describe('lecture web', () => {
  it('extrait le texte utile du HTML', () => {
    const { title, text } = htmlToText(
      '<html><head><title>Prix &amp; offres</title><style>.a{}</style></head><body><script>alert(1)</script><h1>Écran</h1><p>Prix&nbsp;: 299&euro;</p><ul><li>A</li><li>B</li></ul></body></html>',
    );
    expect(title).toBe('Prix & offres');
    expect(text).toContain('Écran');
    expect(text).toContain('299€');
    expect(text).toContain('• A');
    expect(text).not.toContain('alert');
  });
});

describe('secrets', () => {
  it('chiffre et déchiffre', () => {
    const enc = encryptSecret('sk-or-v1-secret');
    expect(enc).not.toContain('secret');
    expect(decryptSecret(enc)).toBe('sk-or-v1-secret');
    expect(maskSecret('sk-or-v1-abcdefghijkl')).toBe('sk-or-v1…ijkl');
  });

  it('détecte une altération', () => {
    const enc = encryptSecret('valeur');
    const parts = enc.split(':');
    parts[3] = Buffer.from('autre').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
});

describe('utilitaires', () => {
  it('sérialise les tours d’un même compagnon', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const task = (name: string, ms: number) =>
      mutex.run('ari', async () => {
        order.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${name}:end`);
      });
    await Promise.all([task('a', 30), task('b', 1)]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(mutex.isLocked('ari')).toBe(false);
  });

  it('partage un démarrage en vol et en autorise un nouveau après échec', async () => {
    const flights = new Map<string, Promise<number>>();
    let runs = 0;
    const succeed = () => singleFlight(flights, 'desk', async () => ++runs);
    const [first, second] = await Promise.all([succeed(), succeed()]);
    expect(first).toBe(1); expect(second).toBe(1); expect(runs).toBe(1);
    expect(await succeed()).toBe(2);
    const fail = () => singleFlight(flights, 'boom', async () => { runs++; throw new Error('boom'); });
    const left = fail(), right = fail();
    await expect(left).rejects.toThrow('boom');
    await expect(right).rejects.toThrow('boom');
    expect(runs).toBe(3);
    await Promise.resolve();
    expect(flights.has('boom')).toBe(false);
    await expect(fail()).rejects.toThrow('boom');
    expect(runs).toBe(4);
  });

  it('tronque proprement', () => {
    expect(truncate('abcdef', 3)).toMatch(/^abc… \[tronqué/);
  });
});

describe('prompt système', () => {
  const agent = {
    id: 'ag_1',
    name: 'Compagnon',
    named: false,
    color: '#fff',
    description: '',
    personality: '',
    instructions: '',
    model: null,
    permissions: DEFAULT_PERMISSIONS,
    state: 'available' as const,
    stateDetail: null,
    createdBy: 'user',
    archived: false,
    sortOrder: 0,
    lastReadAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const base = { agent, team: [agent], memories: [], activities: [], pendingApprovals: [], tz: 'Europe/Paris', now: new Date(), toolNames: [] };

  it("demande de tenir l'utilisateur au courant pendant un échange entre compagnons", () => {
    const prompt = buildSystemPrompt({ ...base, mode: { kind: 'team', peerName: 'Ari', expectsReply: true } });
    expect(prompt).toContain('Keep the user informed');
    expect(prompt).toContain('text_user is delivered to that chat');
    expect(prompt).toContain('never to Ari');
  });

  it("décrit le travail en arrière-plan et la façon de lui transmettre une consigne", () => {
    const prompt = buildSystemPrompt({ ...base, mode: { kind: 'user' }, background: [{ task: 'Intégration Vaultwarden', progress: ['Dépôt cloné'] }] });
    expect(prompt).toContain('Intégration Vaultwarden');
    expect(prompt).toContain('Latest progress: Dépôt cloné');
    expect(prompt).toContain('steer_task');
    expect(prompt).toContain('Do not restart, redo or re-announce');
  });

  it("n'annonce une capture comme visible qu'après un partage réussi", () => {
    const prompt = buildSystemPrompt({ ...base, mode: { kind: 'user' }, toolNames: ['share_screenshot'] });
    expect(prompt).toContain('status "attached"');
  });

  it('invite un compagnon sans nom à demander le sien', () => {
    expect(buildSystemPrompt({ ...base, mode: { kind: 'user' } })).toContain('First meeting');
  });

  it('reste discret quand l’utilisateur ajoute une réaction', () => {
    const p = buildSystemPrompt({ ...base, mode: { kind: 'event', title: 'Réaction', eventType: 'reaction' } });
    expect(p).toContain('<silence/>');
    expect(p).toContain('react_to_message');
    expect(p).not.toContain('ALWAYS end with a short message');
  });

  it('autorise le silence lors des réveils autonomes', () => {
    const p = buildSystemPrompt({ ...base, mode: { kind: 'event', title: 'Mails du matin' } });
    expect(p).toContain('<silence/>');
    expect(p).not.toContain('First meeting');
  });

  it('demande à browser_inspect de réutiliser un navigateur autorisé', () => {
    const prompt = buildSystemPrompt({ ...base, mode: { kind: 'user' }, toolNames: ['browser_inspect', 'computer_inspect'] });
    expect(prompt).toContain('not already running');
    expect(prompt).toContain('computer_request_setup once');
    expect(prompt).not.toContain('Open the browser only when needed');
  });

  it('demande une phrase courte avant une étape d’outils utile', () => {
    const prompt = buildSystemPrompt({ ...base, mode: { kind: 'user' } });
    expect(prompt).toContain('one short sentence');
    expect(prompt).toContain('trivial call');
    expect(prompt).toContain('ordinary reply text');
    expect(prompt).toContain('Never send two messages that say the same thing');
    expect(prompt).toContain('never announce a step instead of doing it');
    expect(prompt).toContain('text_user');
    expect(prompt).toContain('react_to_message');
    expect(prompt).toContain('reply_to');
    expect(prompt).toContain('instant-messaging thread');
  });

  it('ne demande les méta-outils que lorsqu’ils sont réellement disponibles', () => {
    const without = buildSystemPrompt({ ...base, mode: { kind: 'user' } });
    expect(without).not.toContain('call list_capabilities');
    expect(without).toContain('connection_request_setup');
    const withTools = buildSystemPrompt({ ...base, mode: { kind: 'user' }, toolNames: ['list_capabilities', 'load_tools'] });
    expect(withTools).toContain('call list_capabilities');
    expect(withTools).toContain('load_tools');
  });
});

describe('bulles et panneau de travail', () => {
  it('met chaque phrase visible dans une bulle et le reste dans un seul panneau', () => {
    const parts = [
      { type: 'text', text: 'Je vais maintenant créer ce fichier.' },
      { type: 'reasoning', text: 'trace interne' },
      { type: 'tool-shell_exec', state: 'output-available', output: { ok: true, stdout: 'hidden-command-output' } },
      { type: 'tool-text_user', input: { text: 'La copie locale est en cours.' } },
      { type: 'dynamic-tool', toolName: 'mcp_demo', state: 'output-available', output: { ok: true } },
      { type: 'step-start' },
      { type: 'tool-ask_user', state: 'output-available', output: { ok: true, requestId: 'rq' } },
      { type: 'text', text: '<silence/>' },
      { type: 'text', text: 'Réponse finale visible.' },
    ];
    const view = presentAssistantTurn(parts);
    expect(view.bubbles.flatMap((bubble) => 'text' in bubble ? [bubble.text] : [])).toEqual([
      'Je vais maintenant créer ce fichier.',
      'La copie locale est en cours.',
      'Réponse finale visible.',
    ]);
    expect(view.work.map((part) => part.type)).toEqual(['reasoning', 'tool-shell_exec', 'dynamic-tool']);
    expect(view.actions.map((part) => part.type)).toEqual(['tool-ask_user']);
  });

  it('n’accepte qu’un seul emoji', () => {
    expect(isSingleEmoji('👍')).toBe(true);
    expect(isSingleEmoji('❤️')).toBe(true);
    expect(isSingleEmoji('👍👍')).toBe(false);
    expect(isSingleEmoji('ok')).toBe(false);
  });
});

describe('phrases autour des outils', () => {
  it('laisse visibles les phrases écrites avant ou entre les appels', () => {
    const parts = [
      { type: 'text', text: 'Je vais créer ce fichier.' },
      { type: 'reasoning', text: 'trace' },
      { type: 'tool-shell_exec' },
      { type: 'text', text: 'La copie locale est en cours.' },
      { type: 'file', url: '/tmp/a' },
      { type: 'tool-shell_exec' },
    ];
    const { lead, around, work } = partitionToolNarrative(parts);
    expect(lead.map((part) => part.type === 'text' ? part.text : part.type)).toEqual(['Je vais créer ce fichier.']);
    expect(around.map((part) => part.type)).toEqual(['text', 'file']);
    expect(work.map((part) => part.type)).toEqual(['reasoning', 'tool-shell_exec', 'tool-shell_exec']);
  });
});

describe('nettoyage du texte des modèles', () => {
  it('retire les appels d’outils qui fuitent dans le texte', async () => {
    const { cleanModelText } = await import('@opendots/shared');
    const raw =
      'Quel rôle veux-tu ? {"content":"Venty gère les e-mails","kind":"fact"} to=functions.memory_remember {"id":"mem_abc","ok":true}✅ Le compagnon Dev a bien été créé.';
    expect(cleanModelText(raw)).toBe('Quel rôle veux-tu ? ✅ Le compagnon Dev a bien été créé.');
    expect(cleanModelText('Texte normal avec {accolades} et to= rien.')).toBe('Texte normal avec {accolades} et to= rien.');
  });
});

describe('description des horaires', () => {
  it('traduit les cron simples', () => {
    expect(describeSchedule({ type: 'cron', expr: '0 17 * * 5', tz: 'Europe/Paris' })).toBe('le vendredi à 17:00');
    expect(describeSchedule({ type: 'cron', expr: '30 8 * * 1-5' })).toBe('en semaine à 08:30');
  });
});

describe('finalText', () => {
  it('ne garde que le texte écrit après le dernier outil', async () => {
    const { finalText } = await import('../src/conversations/repo.ts');
    expect(finalText({ parts: [
      { type: 'text', text: 'Je vais vérifier.' },
      { type: 'tool-shell_exec', toolCallId: 'a', state: 'output-available', input: {}, output: {} },
      { type: 'text', text: 'Voici le résultat.' },
    ] as never })).toBe('Voici le résultat.');
    expect(finalText({ parts: [
      { type: 'text', text: 'Je vais vérifier.' },
      { type: 'tool-shell_exec', toolCallId: 'a', state: 'output-available', input: {}, output: {} },
    ] as never })).toBe('Je vais vérifier.');
  });
});

describe('captures partagées', () => {
  it("une capture jointe devient une image du fil, un échec reste dans le travail", () => {
    const view = presentAssistantTurn([
      { type: 'tool-share_screenshot', state: 'output-available', toolCallId: 'a', input: {}, output: { ok: true, status: 'attached', url: '/api/attachments/x', filename: 'capture.jpg', mediaType: 'image/jpeg' } },
      { type: 'tool-share_screenshot', state: 'output-available', toolCallId: 'b', input: {}, output: { ok: false, status: 'not_found', error: 'expirée' } },
      { type: 'text', text: 'La voici.' },
    ]);
    expect(view.bubbles).toHaveLength(2);
    expect((view.bubbles[0] as unknown as { image: { url: string } }).image.url).toBe('/api/attachments/x');
    expect(view.work).toHaveLength(1);
  });
});
