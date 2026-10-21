import { getSearchSettings } from '../settings.ts';
import { htmlToText } from './web.ts';

/**
 * Recherche sans compte ni clé : Mwmbl et SearXNG par défaut.
 * Les anciennes intégrations propriétaires sont remplacées par ces moteurs libres.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decode(text: string) {
  return htmlToText(`<p>${text}</p>`).text;
}

// Search pages change attribute order, quoting and class lists regularly.
function attribute(tag: string, name: string): string | undefined {
  const re = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of tag.matchAll(re)) {
    if (m[1].toLowerCase() === name) return m[2] ?? m[3] ?? m[4];
  }
}

function hasClass(tag: string, name: string) {
  return (attribute(tag, 'class') ?? '').split(/\s+/).includes(name);
}

function words(text: string): string[] {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

const STOP_WORDS = new Set('a an and are as at avec ce ces comment coordinates coordonnees dans de des du en est et for from how in is la lat latitude le les long longitude of on or ou pour que quel quelle quels quelles the to un une what where weather meteo today aujourd hui maintenant current forecast previsions'.split(' '));

/** A lexical sanity check, not a claim that a source answers the question. */
function checkResults(query: string, results: SearchResult[]): SearchResult[] {
  const subject = query.replace(/\bsite:\S+|https?:\/\/\S+|\b(?:[\p{L}\p{N}-]+\.)+[a-z]{2,}\b/giu, '');
  const terms = words(subject).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const seen = new Set<string>();
  const usable = results.filter((r) => {
    let url: URL;
    try { url = new URL(r.url); } catch { return false; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !r.title || seen.has(url.href)) return false;
    const text = words(`${r.title} ${r.snippet}`);
    if (terms.length && !terms.some((term) => text.some((w) => w === term || (term.length >= 5 && (w.startsWith(term) || term.startsWith(w) && w.length >= 5))))) return false;
    seen.add(url.href);
    return true;
  });
  if (results.length && !usable.length) {
    throw new Error('Les résultats du moteur sont sans rapport identifiable avec la requête ou leurs liens sont invalides. Reformule la recherche ou configure un autre moteur ; ne les utilise pas comme sources.');
  }
  return usable;
}

function checkSearchPage(html: string, query: string) {
  if (/<(?:form|div)[^>]*(?:challenge-form|b_captcha|id=["']captcha)/i.test(html)) {
    throw new Error('Le moteur demande une vérification anti-robot. Configure un autre moteur de recherche.');
  }
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    if (attribute(m[0], 'name')?.toLowerCase() !== 'q') continue;
    const echoed = attribute(m[0], 'value');
    if (echoed !== undefined && words(decode(echoed)).join(' ') !== words(query).join(' ')) {
      throw new Error('La page du moteur correspond à une autre requête. Résultats ignorés.');
    }
  }
}

// Public endpoints require neither an account nor a local service. Keep the
// list small: at most one request per instance/format and a shared time budget.
const PUBLIC_SEARXNG = ['https://searx.tiekoetter.com', 'https://search.inetol.net', 'https://searx.be'];
const SEARCH_TIMEOUT_MS = 20_000;

type SearchResponse = {
  query: string;
  provider: string;
  instance?: string;
  results: SearchResult[];
};

async function mwmbl(query: string, limit: number, signal: AbortSignal): Promise<SearchResult[]> {
  // The anonymous v1 endpoint returns highlighted text segments, not HTML.
  // Contract: mwmbl/tinysearchengine/search.py, _register_search_v1.
  const res = await fetch(`https://mwmbl.org/api/v1/search/?s=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
  });
  if (!res.ok) throw new Error(`Mwmbl a répondu ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('Réponse Mwmbl invalide.');
  const text = (segments: unknown) => Array.isArray(segments)
    ? segments.map((s) => s && typeof s.value === 'string' ? s.value : '').join('') : '';
  const results = body.filter((r) => r && typeof r.url === 'string').map((r) => ({
    title: text(r.title), url: r.url as string, snippet: text(r.extract).slice(0, 500),
  }));
  return checkResults(query, results).slice(0, limit);
}

function searxngHtml(html: string, query: string): SearchResult[] {
  checkSearchPage(html, query);
  const results: SearchResult[] = [];
  for (const article of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const heading = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(article[1]);
    const link = heading && /(<a\b[^>]*>)([\s\S]*?)<\/a>/i.exec(heading[1]);
    if (!link) continue;
    const snippet = [...article[1].matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p>/gi)]
      .find((p) => hasClass(p[1], 'content'));
    results.push({ title: decode(link[2]), url: decode(attribute(link[1], 'href') ?? ''), snippet: snippet ? decode(snippet[2]) : '' });
  }
  if (!results.length && !/no_results|no results|aucun r[ée]sultat/i.test(html)) {
    throw new Error('Page SearXNG non reconnue (blocage ou format modifié).');
  }
  return results;
}

async function searxng(query: string, limit: number, base: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = new URL(`${base.replace(/\/$/, '')}/search`);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('URL SearXNG invalide.');
  }
  url.searchParams.set('q', query);
  url.searchParams.set('categories', 'general');
  url.searchParams.set('format', 'json');
  let res = await fetch(url.href, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
  });
  // Many public instances deliberately disable JSON, while their standard HTML
  // search remains available. Do not retry throttling (429) or CAPTCHA pages.
  if (res.status === 403) {
    await res.body?.cancel();
    url.searchParams.delete('format');
    res = await fetch(url.href, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
  }
  if (!res.ok) throw new Error(`SearXNG a répondu ${res.status}`);
  const raw = await res.text();
  let results: SearchResult[];
  if (/^\s*\{/.test(raw)) {
    const body = JSON.parse(raw) as { query?: string; results?: unknown[] };
    if (body.query !== undefined && words(body.query).join(' ') !== words(query).join(' ')) {
      throw new Error('SearXNG a répondu pour une autre requête.');
    }
    if (!Array.isArray(body.results)) throw new Error('Réponse SearXNG invalide.');
    results = body.results.flatMap((r) => {
      if (!r || typeof r !== 'object' || !('title' in r) || !('url' in r)) return [];
      if (typeof r.title !== 'string' || typeof r.url !== 'string') return [];
      return [{ title: decode(r.title), url: r.url, snippet: 'content' in r && typeof r.content === 'string' ? decode(r.content) : '' }];
    });
  } else {
    results = searxngHtml(raw, query);
  }
  return checkResults(query, results).slice(0, limit);
}

export async function webSearch(query: string, opts: { limit?: number } = {}): Promise<SearchResponse> {
  query = query.trim();
  if (!query) throw new Error('La requête de recherche est vide.');
  const limit = Number.isFinite(opts.limit) ? Math.min(Math.max(Math.trunc(opts.limit!), 1), 15) : 8;
  const s = await getSearchSettings();
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  if (s.provider === 'mwmbl') return { query, provider: 'mwmbl', results: await mwmbl(query, limit, signal) };
  if (s.provider === 'searxng' && s.url) {
    // A personal instance is explicit: never leak its query to public fallbacks.
    return { query, provider: 'searxng', instance: s.url, results: await searxng(query, limit, s.url, signal) };
  }
  const failures: string[] = [];
  let empty: SearchResponse | undefined;
  if (s.provider !== 'searxng') {
    try {
      const results = await mwmbl(query, limit, signal);
      if (results.length) return { query, provider: 'mwmbl', results };
      empty = { query, provider: 'mwmbl', results: [] };
    } catch (error) {
      failures.push(`Mwmbl : ${error instanceof Error ? error.message : 'échec'}`);
    }
  }
  for (const instance of PUBLIC_SEARXNG) {
    if (signal.aborted) break;
    try {
      const results = await searxng(query, limit, instance, signal);
      if (results.length) return { query, provider: 'searxng', instance, results };
      empty = { query, provider: 'searxng', instance, results: [] };
    } catch (error) {
      failures.push(`${new URL(instance).hostname} : ${error instanceof Error ? error.message : 'échec'}`);
    }
  }
  if (empty) return empty;
  throw new Error(`Recherche gratuite indisponible. ${failures.join(' ')} Réessaie plus tard ou utilise une instance SearXNG personnelle. Aucun compte ni clé API ne sont nécessaires.`);
}
