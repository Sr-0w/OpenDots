import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { getSearchSettings } from '../src/settings.ts';
import { webSearch } from '../src/tools/search.ts';

vi.mock('../src/settings.ts', () => ({ getSearchSettings: vi.fn() }));
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  it('utilise la recherche anonyme Mwmbl et assemble ses segments sans balisage', async () => {
    settings.mockResolvedValue({ provider: 'auto', url: null });
    const fetch = respond([{ url: 'https://example.com/hognoul', title: [{ value: 'Hognoul ', is_bold: true }, { value: 'Awans' }], extract: [{ value: 'Coordonnées' }] }]);
    expect(await webSearch(query)).toEqual({ query, provider: 'mwmbl', results: [
      { title: 'Hognoul Awans', url: 'https://example.com/hognoul', snippet: 'Coordonnées' },
    ] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(url).origin).toBe('https://mwmbl.org');
    expect(new URL(url).pathname).toBe('/api/v1/search/');
    expect(new URL(url).searchParams.get('s')).toBe(query);
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('passe à SearXNG public quand Mwmbl ne couvre pas le lieu', async () => {
    settings.mockResolvedValue({ provider: 'auto', url: null });
    const fetch = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ query, results: [hit()] }));
    vi.stubGlobal('fetch', fetch);
    const out = await webSearch(query);
    expect(out.provider).toBe('searxng');
    expect(out.instance).toBe('https://searx.tiekoetter.com');
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('q')).toBe(query);
  });

  it('change d’instance publique après une limitation sans réessayer la même', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: null });
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ results: [hit()] }));
    vi.stubGlobal('fetch', fetch);
    const out = await webSearch(query);
    expect(out.instance).toBe('https://search.inetol.net');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([url]) => !url.includes('mwmbl.org'))).toBe(true);
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
    respond({ results: [hit('Hyundai Tucson - Fiabilité'), hit("L’Équipe - Actualité du sport"), hit('Histoires érotiques')] });
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

  it('ne lit pas un captcha comme un résultat', async () => {
    settings.mockResolvedValue({ provider: 'searxng', url: personal });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<form id="challenge-form"></form>')));
    await expect(webSearch(query)).rejects.toThrow('anti-robot');
  });

  it('signale l’indisponibilité après des tentatives bornées sans service payant', async () => {
    settings.mockResolvedValue({ provider: 'auto', url: null });
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json({}, 429)));
    vi.stubGlobal('fetch', fetch);
    await expect(webSearch(query)).rejects.toThrow('Recherche gratuite indisponible');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([url]) => !/serper|exa\.ai|brave|tavily/.test(url))).toBe(true);
  });

  it('n’utilise pas les instances publiques si Mwmbl seul est sélectionné', async () => {
    settings.mockResolvedValue({ provider: 'mwmbl', url: null });
    const fetch = respond([]);
    expect((await webSearch(query)).results).toEqual([]);
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
