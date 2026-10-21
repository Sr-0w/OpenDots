import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Lecture de pages web publiques, avec protections SSRF et limites de taille. */

const MAX_BYTES = 2_000_000;

function isPrivateAddress(ip: string): boolean {
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = v4.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL invalide : ${raw}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Seules les URL http(s) sont autorisées.');
  if (process.env.OPENDOTS_ALLOW_PRIVATE_FETCH === '1') return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Les adresses du réseau local ne sont pas accessibles.');
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.some(isPrivateAddress)) throw new Error('Les adresses du réseau local ne sont pas accessibles.');
  return url;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€' };

export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  let body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');
  body = body
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return { title: title ? htmlToText(title).text : null, text: body };
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  title: string | null;
  text: string;
}

export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  const url = await assertPublicUrl(rawUrl);
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OpenDots/0.1; +https://github.com/sr-0w/opendots)',
      Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
      'Accept-Language': 'fr,en;q=0.8',
    },
  }).catch((err: Error & { cause?: { message?: string; code?: string } }) => {
    const reason = err.cause?.code ?? err.cause?.message ?? err.message;
    throw new Error(`Impossible de joindre ${url.hostname} (${reason})`);
  });
  const contentType = res.headers.get('content-type') ?? '';
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (/html|xml/.test(contentType) || /^\s*</.test(raw)) {
    const { title, text } = htmlToText(raw);
    return { url: res.url || url.toString(), status: res.status, contentType, title, text };
  }
  return { url: res.url || url.toString(), status: res.status, contentType, title: null, text: raw };
}
