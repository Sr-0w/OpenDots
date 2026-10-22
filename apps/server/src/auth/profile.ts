import { createHash } from 'node:crypto';
import type { AccountProfileDTO } from '@opendots/shared';

type Cached = { profile: AccountProfileDTO; avatar: Uint8Array | null; mediaType: string };
const cache = new Map<string, { until: number; value: Promise<Cached> }>();
const text = (value: unknown) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120) : '';
export const gravatarHash = (email: string) => createHash('md5').update(email.trim().toLowerCase()).digest('hex');

async function bounded(response: Response, limit: number) {
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
async function lookup(hash: string): Promise<Cached> {
  const [details, photo] = await Promise.allSettled([
    fetch(`https://en.gravatar.com/${hash}.json`, { redirect: 'error', signal: AbortSignal.timeout(2500) }).then(r => bounded(r, 32000)).then(bytes => bytes ? JSON.parse(bytes.toString()) : null),
    fetch(`https://www.gravatar.com/avatar/${hash}?d=404&s=96`, { redirect: 'error', signal: AbortSignal.timeout(2500) }).then(async response => {
      const mediaType = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) return null;
      const bytes = await bounded(response, 128000);
      return bytes ? { bytes, mediaType } : null;
    }),
  ]);
  const entry = details.status === 'fulfilled' ? details.value?.entry?.[0] : null;
  const firstName = text(entry?.name?.givenName), lastName = text(entry?.name?.familyName);
  const name = [firstName, lastName].filter(Boolean).join(' ') || text(entry?.displayName) || text(entry?.preferredUsername) || null;
  const image = photo.status === 'fulfilled' ? photo.value : null;
  return { profile: { name, firstName: firstName || null, lastName: lastName || null, avatarUrl: image ? '/api/account/avatar' : null, source: name || image ? 'gravatar' : null }, avatar: image?.bytes ?? null, mediaType: image?.mediaType ?? '' };
}
/** Public data only; email hashes and external avatar URLs never reach the browser. */
export function accountProfile(email: string): Promise<Cached> {
  const hash = gravatarHash(email), previous = cache.get(hash);
  if (previous && previous.until > Date.now()) return previous.value;
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const value = lookup(hash);
  cache.set(hash, { until: Date.now() + 6 * 3600_000, value });
  return value;
}
