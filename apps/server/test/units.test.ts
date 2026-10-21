import { describe, expect, it } from 'vitest';
import { computeNextRun, validateSchedule, describeSchedule } from '../src/activities/repo.ts';
import { htmlToText } from '../src/tools/web.ts';
import { decryptSecret, encryptSecret, maskSecret } from '../src/secrets.ts';
import { KeyedMutex, truncate } from '../src/util.ts';
import { buildSystemPrompt } from '../src/agents/prompt.ts';
import { DEFAULT_PERMISSIONS } from '@opendots/shared';

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

  it('invite un compagnon sans nom à demander le sien', () => {
    expect(buildSystemPrompt({ ...base, mode: { kind: 'user' } })).toContain('First meeting');
  });

  it('autorise le silence lors des réveils autonomes', () => {
    const p = buildSystemPrompt({ ...base, mode: { kind: 'event', title: 'Mails du matin' } });
    expect(p).toContain('<silence/>');
    expect(p).not.toContain('First meeting');
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
