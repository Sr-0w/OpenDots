import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { getSearchSettings } from '../src/settings.ts';
import { webSearch } from '../src/tools/search.ts';
import { ensureLocalSearch } from '../src/tools/local-search.ts';

vi.mock('../src/settings.ts', () => ({ getSearchSettings: vi.fn() }));
vi.mock('../src/tools/local-search.ts', () => ({ ensureLocalSearch: vi.fn() }));
const settings = vi.mocked(getSearchSettings);
const query = 'Hognoul Awans coordinates';
const personal = 'https://searx.example';
const hit = (title = 'Hognoul Awans', url = 'https://example.com/hognoul', content = 'Coordonnées en Belgique') => ({ title, url, content });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const article = (title = 'Hognoul Awans', url = 'https://example.com/hognoul') =>
  `<article class='result'><h3><a class="url_header" href='${url}'>${title}</a></h3><p class='content extra'>Coordonnées : 50.65, 5.44</p></article>`;
function respond(body: unknown) {
  const fetch = vi.fn().mockResolvedValue(json(body));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('recherche libre sans clé', () => {
  it('exécute une vraie requête HTTP vers une instance personnelle avec repli JSON → HTML', async () => {
    const requests: URL[] = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      requests.push(url);
      if (url.searchParams.get('format') === 'json') { res.writeHead(403); res.end(); }
      else { res.setHeader('content-type', 'text/html'); res.end(article()); }
    });
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Serveur non démarré');
      const base = `http://127.0.0.1:${address.port}`;
      settings.mockResolvedValue({ provider: 'searxng', url: base });
      const out = await webSearch(query);
      expect(out.instance).toBe(base);
      expect(out.results[0].title).toBe('Hognoul Awans');
      expect(requests).toHaveLength(2);
      expect(requests.every((url) => url.pathname === '/search' && url.searchParams.get('q') === query)).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('utilise uniquement SearXNG local par défaut, après sa disponibilité', async () => {
    settings.mockResolvedValue({ provider: 'auto', url: null });
    vi.mocked(ensureLocalSearch).mockResolvedValue('http://127.0.0.1:18888');
    const fetch = respond({ query, results: [hit()] });
    const out = await webSearch(query);
    expect(out.provider).toBe('searxng');
    expect(out.instance).toBe('http://127.0.0.1:18888');
    expect(ensureLocalSearch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).origin).toBe('http://127.0.0.1:18888');
  });

  it('utilise l’API anonyme Mwmbl v2 uniquement quand elle est sélectionnée', async () => {
    settings.mockResolvedValue({ provider: 'mwmbl', url: null });
    const fetch = respond({ query, results: [hit()] });
    const out = await webSearch(query);
    expect(out.provider).toBe('mwmbl');
    expect(out.status).toBe('results');
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/v2/search/');
    expect(new URL(url).searchParams.get('q')).toBe(query);
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(ensureLocalSearch).not.toHaveBeenCalled();
  });

  it('élargit explicitement une recherche Mwmbl vide sans prétendre filtrer les dates', async () => {
    settings.mockResolvedValue({ provider: 'mwmbl', url: null });
    const q = 'OpenRouter changelog';
    const fetch = vi.fn().mockResolvedValueOnce(json({ query: q, results: [] }))
      .mockResolvedValueOnce(json({ query: 'OpenRouter', results: [{ title: 'OpenRouter Blog', url: 'https://openrouter.ai/blog', content: 'Updates' }] }));
    vi.stubGlobal('fetch', fetch);
    const out = await webSearch(q);
    expect(out.effectiveQuery).toBe('OpenRouter');
    expect(out.notice).toContain('dates');
    expect(out.results).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ne transmet aucune requête à un service public si Docker manque', async () => {
    settings.mockResolvedValue({ provider: 'auto', url: null });
    vi.mocked(ensureLocalSearch).mockRejectedValue(new Error('Docker indisponible'));
    const fetch = respond({});
    await expect(webSearch(query)).rejects.toThrow('Docker');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lit le HTML SearXNG quand le format JSON est désactivé', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 403))
      .mockResolvedValueOnce(new Response(`<input value='Hognoul Awans coordinates' name='q'>${article()}`));
    vi.stubGlobal('fetch', fetch);
    expect((await webSearch(query)).results).toEqual([
      { title: 'Hognoul Awans', url: 'https://example.com/hognoul', snippet: 'Coordonnées : 50.65, 5.44' },
    ]);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('format')).toBe('json');
    expect(new URL(fetch.mock.calls[1][0]).searchParams.has('format')).toBe(false);
  });

  it('ne transmet pas une recherche personnelle aux instances publiques en cas d’échec', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    const fetch = vi.fn().mockRejectedValue(new Error('connexion impossible'));
    vi.stubGlobal('fetch', fetch);
    await expect(webSearch(query)).rejects.toThrow('connexion impossible');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).origin).toBe(personal);
  });

  it('refuse les résultats hors sujet de la conversation fournie', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    respond({ results: [hit('Hyundai Tucson - Fiabilité', 'https://example.com/car'), hit("L’Équipe - Actualité du sport", 'https://example.com/sport'), hit('Histoires érotiques', 'https://example.com/stories')] });
    await expect(webSearch(query)).rejects.toThrow('sans rapport');
  });

  it.each(['weather Hognoul Awans today', 'Hognoul weather.com'])('rejette la météo d’une autre ville pour %s', async (q) => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    respond({ results: [hit('Weather Forecast Le Locle - weather.com', 'https://example.com/locle', 'Météo en Suisse')] });
    await expect(webSearch(q)).rejects.toThrow('sans rapport');
  });

  it('détecte une réponse JSON pour une autre requête', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    respond({ query: 'Le Locle météo', results: [hit()] });
    await expect(webSearch(query)).rejects.toThrow('autre requête');
  });

  it('détecte aussi une autre requête dans le formulaire HTML', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<input name='q' value='Le Locle météo'>${article()}`)));
    await expect(webSearch(query)).rejects.toThrow('autre requête');
  });

  it('retire liens invalides, doublons et résultats étrangers avant la limite', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    respond({ results: [hit('Football', 'https://example.com/sport', ''), hit('Hognoul', 'javascript:alert(1)'), hit(), hit()] });
    expect((await webSearch(query, { limit: 1 })).results).toEqual([
      { title: 'Hognoul Awans', url: 'https://example.com/hognoul', snippet: 'Coordonnées en Belgique' },
    ]);
  });

  it('distingue un vrai résultat vide d’une page de blocage non reconnue', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    respond({ results: [] });
    expect((await webSearch(query)).results).toEqual([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Access denied</html>')));
    await expect(webSearch(query)).rejects.toThrow('non reconnue');
  });

  it('ne rapporte pas un succès vide quand les moteurs amont ont échoué', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    respond({ results: [], unresponsive_engines: [['duckduckgo', 'SSL error']] });
    await expect(webSearch(query)).rejects.toThrow('moteurs en erreur');
  });

  it('ne lit pas un captcha comme un résultat', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<form id="challenge-form"></form>')));
    await expect(webSearch(query)).rejects.toThrow('anti-robot');
  });

  it('signale un vrai résultat vide sans le confondre avec une couverture complète du web', async () => {
    settings.mockResolvedValue({ provider: 'mwmbl', url: null });
    const fetch = respond({ query: 'OpenRouter', results: [] });
    const out = await webSearch('OpenRouter');
    expect(out.status).toBe('no_results');
    expect(out.notice).toContain('couverture est limitée');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejette un contrat Mwmbl invalide et une recherche vide', async () => {
    settings.mockResolvedValue({ provider: 'mwmbl', url: null });
    const fetch = respond({ results: [] });
    await expect(webSearch(query)).rejects.toThrow('Mwmbl invalide');
    await expect(webSearch('   ')).rejects.toThrow('vide');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
