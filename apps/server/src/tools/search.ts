import { getSearchSettings } from '../settings.ts';
import { htmlToText } from './web.ts';
import { ensureLocalSearch } from './local-search.ts';

/**
 * Recherche sans compte ni clé : SearXNG local par défaut, Mwmbl en option.
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

const STOP_WORDS = new Set('a an and are as at avec ce ces comment coordinates coordonnees dans de des du en est et for from how in is la lat latitude le les long longitude of on or ou pour que quel quelle quels quelles the to un une what where weather meteo today aujourd hui maintenant current forecast previsions latest recent updates update changelog news dernier dernieres derniere derniers nouveautes actualites mises jour january february march april may june july august september october november december janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre'.split(' '));

/** A lexical sanity check, not a claim that a source answers the question. */
function checkResults(query: string, results: SearchResult[]): SearchResult[] {
  const subject = query.replace(/\bsite:\S+|https?:\/\/\S+|\b(?:[\p{L}\p{N}-]+\.)+[a-z]{2,}\b/giu, '');
  const terms = words(subject).filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^20\d{2}$/.test(w));
  const seen = new Set<string>();
  const usable = results.filter((r) => {
    let url: URL;
    try { url = new URL(r.url); } catch { return false; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !r.title || seen.has(url.href)) return false;
    const text = words(`${r.title} ${r.snippet} ${url.hostname} ${url.pathname}`);
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

const SEARCH_TIMEOUT_MS = 20_000;

type SearchResponse = {
  query: string;
  effectiveQuery?: string;
  provider: string;
  instance?: string;
  status: 'results' | 'no_results';
  notice?: string;
  results: SearchResult[];
};

async function mwmbl(query: string, limit: number, signal: AbortSignal): Promise<SearchResult[]> {
  // Anonymous v2 returns plain text and an echoed query, unlike the legacy v1
  // formatter. No API key or account is sent, and no paid/super-search is used.
  const res = await fetch(`https://mwmbl.org/api/v2/search/?q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
  });
  if (!res.ok) throw new Error(`Mwmbl a répondu ${res.status}`);
  const body = await res.json() as { query?: unknown; results?: unknown };
  if (body.query !== query || !Array.isArray(body.results)) throw new Error('Réponse Mwmbl invalide ou pour une autre requête.');
  const results = body.results.flatMap((r) => {
    if (!r || typeof r.url !== 'string' || typeof r.title !== 'string' || typeof r.content !== 'string') return [];
    return [{ title: r.title, url: r.url, snippet: r.content.slice(0, 500) }];
  });
  return checkResults(query, results).slice(0, limit);
}

// A sparse index may miss a long query. Widen it once, explicitly, rather than
// pretending that a date filter was applied or sending it to blocked instances.
function broaderQuery(query: string): string | null {
  if (/site:|["]/.test(query)) return null;
  const broader = query.split(/\s+/).filter((word) => {
    const key = words(word).join('');
    return key.length >= 2 && !STOP_WORDS.has(key) && !/^20\d{2}$/.test(key);
  }).join(' ');
  return broader && broader !== query ? broader : null;
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
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  // Many public instances deliberately disable JSON, while their standard HTML
  // search remains available. Do not retry throttling (429) or CAPTCHA pages.
  if (res.status === 403) {
    await res.body?.cancel();
    url.searchParams.delete('format');
    res = await fetch(url.href, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
  }
  if (!res.ok) throw new Error(`SearXNG a répondu ${res.status}`);
  const raw = await res.text();
  let results: SearchResult[];
  if (/^\s*\{/.test(raw)) {
    const body = JSON.parse(raw) as { query?: string; results?: unknown[]; unresponsive_engines?: unknown[] };
    if (body.query !== undefined && words(body.query).join(' ') !== words(query).join(' ')) {
      throw new Error('SearXNG a répondu pour une autre requête.');
    }
    if (!Array.isArray(body.results)) throw new Error('Réponse SearXNG invalide.');
    if (!body.results.length && body.unresponsive_engines?.length) {
      throw new Error('SearXNG n’a obtenu aucun résultat et signale des moteurs en erreur. Vérifie la connexion et les logs du moteur local ; ne traite pas cet échec comme une absence d’information.');
    }
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
  // First use can download the image. Start the query deadline after readiness.
  const local = s.provider === 'auto' ? await ensureLocalSearch() : null;
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  if (local) {
    const results = await searxng(query, limit, local, signal);
    return { query, provider: 'searxng', instance: local, status: results.length ? 'results' : 'no_results', results };
  }
  if (s.provider === 'searxng') {
    if (!s.url) throw new Error('Configure l’URL de ton instance SearXNG ou utilise le mode automatique sans compte.');
    const results = await searxng(query, limit, s.url, signal);
    return { query, provider: 'searxng', instance: s.url, status: results.length ? 'results' : 'no_results', results };
  }
  let results = await mwmbl(query, limit, signal);
  const broader = !results.length ? broaderQuery(query) : null;
  if (broader) results = checkResults(query, await mwmbl(broader, limit, signal));
  return {
    query,
    ...(broader ? { effectiveQuery: broader } : {}),
    provider: 'mwmbl',
    status: results.length ? 'results' : 'no_results',
    ...(broader || !results.length ? {
      notice: results.length
        ? 'Recherche élargie : les critères de date ne sont pas garantis. Vérifie les dates et les faits dans les pages sources.'
        : 'Aucun résultat exploitable dans l’index Mwmbl, dont la couverture est limitée. Ne déduis pas que l’information n’existe pas et n’invente pas d’URL.',
    } : {}),
    results,
  };
}
