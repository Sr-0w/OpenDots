import { getSearchSettings } from '../settings.ts';
import { htmlToText } from './web.ts';

/**
 * Recherche web. DuckDuckGo fonctionne sans clé ; Brave, Tavily ou une
 * instance SearXNG peuvent être configurés pour plus de fiabilité.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decode(text: string) {
  return htmlToText(`<p>${text}</p>`).text;
}

async function duckduckgo(query: string, limit: number, region?: string): Promise<SearchResult[]> {
  const body = new URLSearchParams({ q: query, kl: region ?? 'fr-fr' });
  const res = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'fr,en;q=0.8' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo a répondu ${res.status}`);
  const html = await res.text();
  if (/anomaly|challenge-form/i.test(html) && !html.includes('result-link')) {
    throw new Error('DuckDuckGo limite temporairement les requêtes. Configure un autre moteur (Brave, Tavily, SearXNG) dans les paramètres.');
  }
  const out: SearchResult[] = [];
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td class='result-snippet'>([\s\S]*?)<\/td>/g;
  const snippets = [...html.matchAll(snippetRe)].map((m) => decode(m[1]));
  let i = 0;
  for (const m of html.matchAll(linkRe)) {
    let url = m[1];
    const redirect = /[?&]uddg=([^&]+)/.exec(url);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // publicités
    out.push({ title: decode(m[2]), url, snippet: snippets[i] ?? '' });
    i++;
    if (out.length >= limit) break;
  }
  return out;
}

/** Bing (sans clé) : liens publiés sous forme de redirections /ck/a?u=a1<base64url>. */
async function bing(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=fr&count=${limit + 2}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.8' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Bing a répondu ${res.status}`);
  const html = await res.text();
  const out: SearchResult[] = [];
  for (const m of html.matchAll(/<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g)) {
    const h = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(m[1]);
    if (!h) continue;
    let url = h[1].replace(/&amp;/g, '&');
    const u = /[?&]u=a1([^&]+)/.exec(url);
    if (u) {
      try {
        url = Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      } catch {
        // lien laissé tel quel
      }
    }
    if (!/^https?:\/\//.test(url)) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(m[1]);
    out.push({ title: decode(h[2]), url, snippet: p ? decode(p[1]).replace(/^.*?\u00b7\s*/, '') : '' });
    if (out.length >= limit) break;
  }
  return out;
}

async function brave(query: string, limit: number, key: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Brave Search a répondu ${res.status}`);
  const body = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  return (body.web?.results ?? []).slice(0, limit).map((r) => ({ title: r.title, url: r.url, snippet: decode(r.description ?? '') }));
}

async function tavily(query: string, limit: number, key: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: limit }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Tavily a répondu ${res.status}`);
  const body = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (body.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? '').slice(0, 400) }));
}

async function searxng(query: string, limit: number, base: string): Promise<SearchResult[]> {
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SearXNG a répondu ${res.status}`);
  const body = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (body.results ?? []).slice(0, limit).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
}

export async function webSearch(query: string, opts: { limit?: number; region?: string } = {}): Promise<{ provider: string; results: SearchResult[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 15);
  const s = await getSearchSettings();
  switch (s.provider) {
    case 'brave':
      if (!s.apiKey) throw new Error('Clé Brave Search manquante.');
      return { provider: 'brave', results: await brave(query, limit, s.apiKey) };
    case 'tavily':
      if (!s.apiKey) throw new Error('Clé Tavily manquante.');
      return { provider: 'tavily', results: await tavily(query, limit, s.apiKey) };
    case 'searxng':
      if (!s.url) throw new Error('URL SearXNG manquante.');
      return { provider: 'searxng', results: await searxng(query, limit, s.url) };
    case 'bing':
      return { provider: 'bing', results: await bing(query, limit) };
    case 'duckduckgo':
      return { provider: 'duckduckgo', results: await duckduckgo(query, limit, opts.region) };
    default: {
      // Automatique : DuckDuckGo, puis Bing si DuckDuckGo bloque ou ne renvoie rien.
      try {
        const results = await duckduckgo(query, limit, opts.region);
        if (results.length) return { provider: 'duckduckgo', results };
      } catch {
        // repli
      }
      return { provider: 'bing', results: await bing(query, limit) };
    }
  }
}
