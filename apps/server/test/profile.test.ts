import { afterEach, expect, it, vi } from 'vitest';
import { accountProfile, gravatarHash } from '../src/auth/profile.ts';
afterEach(() => vi.unstubAllGlobals());
it('normalise l’adresse et ne transmet que son hash au service public', async () => {
  const fetcher = vi.fn(async (url: string) => url.endsWith('.json')
    ? Response.json({ entry: [{ name: { givenName: 'Robin', familyName: 'Snyders' }, displayName: 'Alias', thumbnailUrl: 'https://tracking.invalid/photo' }] })
    : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetcher);
  const value = await accountProfile(' Robin@Example.com ');
  expect(value.profile).toMatchObject({ name: 'Robin Snyders', firstName: 'Robin', lastName: 'Snyders', avatarUrl: '/api/account/avatar', source: 'gravatar' });
  expect(fetcher.mock.calls.every(([url]) => url.includes(gravatarHash('robin@example.com')) && !url.includes('@'))).toBe(true);
  expect(JSON.stringify(value.profile)).not.toContain('tracking.invalid');
  await accountProfile('robin@example.com'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('revient au profil local sans erreur si Gravatar est absent ou inaccessible', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  const result = await accountProfile('offline@example.com');
  expect(result.profile).toEqual({ name: null, firstName: null, lastName: null, avatarUrl: null, source: null });
});
it('ignore les avatars HTML et les réponses de profil trop grandes', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('.json') ? new Response('x'.repeat(33000)) : new Response('<script>bad</script>', { headers: { 'content-type': 'text/html' } })));
  expect((await accountProfile('invalid@example.com')).profile.source).toBeNull();
});
